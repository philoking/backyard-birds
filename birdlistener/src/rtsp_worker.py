"""Per-camera worker: ffmpeg -> 3s audio window -> BirdNET -> TimescaleDB.

Runs in its own multiprocessing.Process so that:
  * an ffmpeg crash can't take down other cameras,
  * each camera has its own BirdNET analyzer (tflite-runtime holds state),
  * CPU-bound analysis on one camera doesn't fight the GIL with another.
"""
from __future__ import annotations

import logging
import subprocess
import time
from datetime import datetime
from typing import Any, Dict, Optional

import numpy as np

from .audio import encode_clip
from .db import insert_detections, store_clip


# BirdNET's model is trained on 48kHz mono 3-second windows.
SAMPLE_RATE = 48_000
WINDOW_SECONDS = 3.0
BYTES_PER_SAMPLE = 2  # s16le
WINDOW_SAMPLES = int(SAMPLE_RATE * WINDOW_SECONDS)
WINDOW_BYTES = WINDOW_SAMPLES * BYTES_PER_SAMPLE

log = logging.getLogger(__name__)


def _ffmpeg_cmd(rtsp_url: str) -> list[str]:
    """Build the ffmpeg command that decodes RTSP audio to raw PCM on stdout."""
    return [
        "ffmpeg",
        "-loglevel", "warning",
        "-nostdin",
        "-fflags", "nobuffer",
        "-flags", "low_delay",
        "-rtsp_transport", "tcp",   # Amcrest is happier over TCP than UDP
        "-timeout", "5000000",       # 5s socket timeout (microseconds)
        "-i", rtsp_url,
        "-vn",                       # discard video
        "-ac", "1",                  # mono
        "-ar", str(SAMPLE_RATE),     # 48 kHz
        "-f", "s16le",
        "-acodec", "pcm_s16le",
        "-",                         # stdout
    ]


def _read_exact(pipe, n: int) -> Optional[bytes]:
    """Read exactly n bytes or return None on EOF."""
    chunks = []
    remaining = n
    while remaining > 0:
        buf = pipe.read(remaining)
        if not buf:
            return None
        chunks.append(buf)
        remaining -= len(buf)
    return b"".join(chunks)


def _analyze(analyzer, audio_f32: np.ndarray, lat, lon, min_conf, sensitivity):
    """Run BirdNET on a single 3-second window. Returns list[dict]."""
    from birdnetlib import RecordingBuffer  # imported lazily

    kwargs: Dict[str, Any] = dict(
        buffer=audio_f32,
        rate=SAMPLE_RATE,
        date=datetime.now(),
        min_conf=float(min_conf),
        sensitivity=float(sensitivity),
    )
    if lat is not None and lon is not None:
        kwargs["lat"] = float(lat)
        kwargs["lon"] = float(lon)

    rec = RecordingBuffer(analyzer, **kwargs)
    rec.analyze()
    return list(rec.detections or [])


class _ClipCapture:
    """Rolling-buffer clip capture with lead-in/lead-out padding.

    BirdNET analyzes a bare 3s window, which clips calls at the edges. We keep a
    rolling buffer of recent audio so a stored clip can include `pre` seconds
    before and `post` seconds after the detection window. The "after" padding
    isn't available yet at detection time, so we queue the clip and write it once
    enough later audio has been read (usually the very next iteration).

    Best-effort: encode/store failures are caught and logged so clip capture
    never disrupts detection logging. A per-species cooldown spreads clips out.
    """

    def __init__(self, db_dsn, camera, pre_samples, post_samples, keep, min_interval):
        self.db_dsn = db_dsn
        self.camera = camera
        self.pre = int(pre_samples)
        self.post = int(post_samples)
        self.keep = int(keep)
        self.min_interval = float(min_interval)
        self.maxlen = WINDOW_SAMPLES + self.pre + self.post + 2 * WINDOW_SAMPLES
        self.buf = np.empty(0, dtype=np.int16)
        self.total = 0  # absolute count of samples ever appended
        self.pending: list[dict] = []
        self.last_clip_at: Dict[str, float] = {}

    def reset(self, initial: np.ndarray) -> None:
        """Start a fresh buffer (e.g. after an ffmpeg reconnect)."""
        self.buf = initial.copy()
        self.total = int(len(initial))
        self.pending = []

    def append(self, new_samples: np.ndarray) -> None:
        self.buf = np.concatenate([self.buf, new_samples])
        self.total += int(len(new_samples))
        if len(self.buf) > self.maxlen:
            self.buf = self.buf[-self.maxlen:]

    def queue(self, ts: datetime, detections: list, now_mono: float) -> None:
        """Record a padded clip request for the window ending at the current
        buffer position (covers samples [total - WINDOW, total))."""
        eligible = []
        for d in detections:
            common = d.get("common_name")
            if not common:
                continue
            last = self.last_clip_at.get(common)
            if last is not None and (now_mono - last) < self.min_interval:
                continue
            eligible.append(d)
        if not eligible:
            return
        for d in eligible:
            self.last_clip_at[d["common_name"]] = now_mono
        self.pending.append({
            "ts": ts,
            "dets": eligible,
            "clip_start": self.total - WINDOW_SAMPLES - self.pre,
            "clip_end": self.total + self.post,
        })

    def flush_ready(self) -> None:
        """Write any queued clips whose post-padding has now been buffered."""
        if not self.pending:
            return
        buf_start = self.total - len(self.buf)
        still = []
        for p in self.pending:
            if self.total < p["clip_end"]:
                still.append(p)  # not enough trailing audio yet
                continue
            s = max(p["clip_start"], buf_start) - buf_start
            e = min(p["clip_end"], self.total) - buf_start
            self._store(p["ts"], self.buf[s:e], p["dets"])
        self.pending = still

    def _store(self, ts: datetime, clip: np.ndarray, dets: list) -> None:
        try:
            audio, mime = encode_clip(clip)
        except Exception as e:
            log.warning("[%s] clip encode failed: %s", self.camera, e)
            return
        for d in dets:
            try:
                store_clip(
                    self.db_dsn, ts, self.camera, d["common_name"],
                    d.get("scientific_name"), float(d.get("confidence", 0.0)),
                    audio, mime, keep=self.keep,
                )
            except Exception as e:
                log.error("[%s] clip store failed for %s: %s", self.camera, d["common_name"], e)


def run_camera(
    camera_cfg: dict,
    global_cfg: dict,
    db_dsn: str,
    shutdown_event,
) -> None:
    """Entry point for a camera worker process."""
    # Configure logging inside child process.
    logging.basicConfig(
        level=global_cfg.get("log_level", "INFO"),
        format="%(asctime)s %(levelname)s [%(processName)s] %(message)s",
    )

    name = camera_cfg["name"]
    rtsp_url = camera_cfg["rtsp_url"]

    loc = global_cfg.get("default_location") or {}
    lat = camera_cfg.get("latitude") if camera_cfg.get("latitude") is not None else loc.get("latitude")
    lon = camera_cfg.get("longitude") if camera_cfg.get("longitude") is not None else loc.get("longitude")

    min_conf = float(global_cfg.get("min_confidence", 0.7))
    sensitivity = float(global_cfg.get("sensitivity", 1.0))
    overlap = float(global_cfg.get("overlap_seconds", 0.0))

    save_clips = bool(global_cfg.get("save_clips", True))
    clip_keep = int(global_cfg.get("clip_keep", 5))
    clip_min_interval = float(global_cfg.get("clip_min_interval_seconds", 30.0))
    pre_samples = int(float(global_cfg.get("clip_pad_before_seconds", 1.5)) * SAMPLE_RATE)
    post_samples = int(float(global_cfg.get("clip_pad_after_seconds", 1.5)) * SAMPLE_RATE)
    capture = (
        _ClipCapture(db_dsn, name, pre_samples, post_samples, clip_keep, clip_min_interval)
        if save_clips else None
    )

    advance_samples = max(1, int(WINDOW_SAMPLES - overlap * SAMPLE_RATE))
    advance_bytes = advance_samples * BYTES_PER_SAMPLE

    log.info(
        "[%s] starting; lat=%s lon=%s min_conf=%.2f sens=%.2f overlap=%.2fs",
        name, lat, lon, min_conf, sensitivity, overlap,
    )

    # Load analyzer once per worker. This is ~65MB and takes a second or two.
    from birdnetlib.analyzer import Analyzer
    analyzer = Analyzer()
    log.info("[%s] BirdNET analyzer loaded", name)

    backoff = 1.0

    while not shutdown_event.is_set():
        proc = None
        try:
            log.info("[%s] connecting to %s", name, _redact(rtsp_url))
            proc = subprocess.Popen(
                _ffmpeg_cmd(rtsp_url),
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                bufsize=0,
            )

            # Prime with a full 3s window.
            first = _read_exact(proc.stdout, WINDOW_BYTES)
            if first is None:
                raise RuntimeError("ffmpeg closed before any audio arrived")
            window = np.frombuffer(first, dtype=np.int16).copy()
            if capture is not None:
                capture.reset(window)
            backoff = 1.0  # successful connect, reset

            while not shutdown_event.is_set():
                t0 = time.monotonic()
                audio_f32 = (window.astype(np.float32) / 32768.0)

                try:
                    detections = _analyze(
                        analyzer, audio_f32, lat, lon, min_conf, sensitivity
                    )
                except Exception as e:
                    log.warning("[%s] analyze failed: %s", name, e)
                    detections = []

                if detections:
                    ts = datetime.now()
                    try:
                        insert_detections(db_dsn, ts, name, detections)
                    except Exception as e:
                        log.error("[%s] DB insert failed: %s", name, e)

                    for d in detections:
                        log.info(
                            "[%s] %s (%s) conf=%.2f",
                            name,
                            d.get("common_name"),
                            d.get("scientific_name"),
                            float(d.get("confidence", 0.0)),
                        )

                    if capture is not None:
                        capture.queue(ts, detections, t0)
                else:
                    log.debug("[%s] no detections in window", name)

                # Slide the window forward.
                nxt = _read_exact(proc.stdout, advance_bytes)
                if nxt is None:
                    raise RuntimeError("ffmpeg stream ended")
                new_samples = np.frombuffer(nxt, dtype=np.int16)
                window = np.concatenate([window[advance_samples:], new_samples])

                # Feed the same audio to the clip buffer and write any padded
                # clips whose trailing context has now arrived.
                if capture is not None:
                    capture.append(new_samples)
                    capture.flush_ready()

                elapsed = time.monotonic() - t0
                log.debug("[%s] cycle time %.2fs", name, elapsed)

        except Exception as e:
            log.error("[%s] worker error: %s", name, e)
        finally:
            if proc is not None:
                try:
                    proc.kill()
                except Exception:
                    pass
                try:
                    proc.wait(timeout=2)
                except Exception:
                    pass

        if shutdown_event.is_set():
            break
        sleep_s = min(backoff, 30.0)
        log.warning("[%s] reconnecting in %.1fs", name, sleep_s)
        shutdown_event.wait(sleep_s)
        backoff = min(backoff * 2.0, 30.0)

    log.info("[%s] stopped", name)


def _redact(url: str) -> str:
    """Hide the password portion of an RTSP URL for log output."""
    if "@" not in url:
        return url
    scheme, rest = url.split("://", 1) if "://" in url else ("", url)
    creds, host = rest.split("@", 1)
    if ":" in creds:
        user, _ = creds.split(":", 1)
        creds = f"{user}:***"
    return f"{scheme}://{creds}@{host}" if scheme else f"{creds}@{host}"
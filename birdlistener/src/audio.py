"""Encode raw PCM detection windows to a small browser-playable clip.

The worker hands us the exact int16 mono window BirdNET analyzed; we shell out
to the ffmpeg already present in the container to produce a compact Opus (or
MP3) clip. A ~3s mono window encodes to a few KB, small enough to live in the
database alongside the detection metadata.
"""
from __future__ import annotations

import logging
import subprocess
from typing import Optional, Tuple

import numpy as np

log = logging.getLogger(__name__)

SAMPLE_RATE = 48_000  # matches rtsp_worker's BirdNET window rate

# (codec, ffmpeg args, mime). Opus is preferred; if this build of ffmpeg lacks
# libopus we fall back to libmp3lame. Probed once and cached.
_OPUS = ("libopus", ["-c:a", "libopus", "-b:a", "32k", "-f", "ogg"], "audio/ogg")
_MP3 = ("libmp3lame", ["-c:a", "libmp3lame", "-b:a", "48k", "-f", "mp3"], "audio/mpeg")

_chosen: Optional[Tuple[str, list, str]] = None


def _ffmpeg_has(encoder: str) -> bool:
    try:
        out = subprocess.run(
            ["ffmpeg", "-hide_banner", "-encoders"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=10,
        )
        return encoder.encode() in out.stdout
    except Exception:
        return False


def _select_encoder() -> Tuple[str, list, str]:
    global _chosen
    if _chosen is None:
        if _ffmpeg_has("libopus"):
            _chosen = _OPUS
        elif _ffmpeg_has("libmp3lame"):
            _chosen = _MP3
        else:
            raise RuntimeError("ffmpeg has neither libopus nor libmp3lame")
        log.info("clip encoder: %s (%s)", _chosen[0], _chosen[2])
    return _chosen


def encode_clip(window_int16: np.ndarray) -> Tuple[bytes, str]:
    """Encode a mono int16 PCM window. Returns (bytes, mime).

    Raises on failure; callers should treat clip storage as best-effort and log.
    """
    _codec, codec_args, mime = _select_encoder()
    pcm = np.ascontiguousarray(window_int16, dtype=np.int16).tobytes()
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel", "error",
        "-f", "s16le",
        "-ar", str(SAMPLE_RATE),
        "-ac", "1",
        "-i", "pipe:0",
        *codec_args,
        "pipe:1",
    ]
    proc = subprocess.run(
        cmd,
        input=pcm,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=30,
    )
    if proc.returncode != 0 or not proc.stdout:
        raise RuntimeError(
            f"ffmpeg encode failed (rc={proc.returncode}): "
            f"{proc.stderr.decode('utf-8', 'replace').strip()}"
        )
    return proc.stdout, mime

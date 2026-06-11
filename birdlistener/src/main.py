"""BirdListener entrypoint.

Spawns one worker subprocess per camera, supervises them, and exits cleanly
on SIGINT / SIGTERM. Dead workers are automatically restarted.
"""
from __future__ import annotations

import logging
import os
import signal
import sys
from multiprocessing import Event, Process

from .config import AppConfig, CameraConfig, load_config
from .db import init_db
from .rtsp_worker import run_camera


def _setup_logging() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s [%(processName)s] %(message)s",
    )


def _global_cfg_dict(cfg: AppConfig) -> dict:
    return {
        "min_confidence": cfg.min_confidence,
        "sensitivity": cfg.sensitivity,
        "overlap_seconds": cfg.overlap_seconds,
        "save_clips": cfg.save_clips,
        "clip_keep": cfg.clip_keep,
        "clip_min_interval_seconds": cfg.clip_min_interval_seconds,
        "clip_pad_before_seconds": cfg.clip_pad_before_seconds,
        "clip_pad_after_seconds": cfg.clip_pad_after_seconds,
        "default_location": (
            cfg.default_location.model_dump() if cfg.default_location else {}
        ),
        "log_level": os.environ.get("LOG_LEVEL", "INFO"),
    }


def _spawn(cam: CameraConfig, global_cfg: dict, db_dsn: str, shutdown) -> Process:
    p = Process(
        target=run_camera,
        args=(cam.model_dump(), global_cfg, db_dsn, shutdown),
        name=f"cam-{cam.name}",
        daemon=False,
    )
    p.start()
    return p


def main() -> int:
    _setup_logging()
    log = logging.getLogger("main")

    config_path = os.environ.get("CONFIG_PATH", "config.yaml")

    try:
        cfg = load_config(config_path)
    except FileNotFoundError:
        log.error(
            "Config file %s not found. Copy config.yaml.example to config.yaml.",
            config_path,
        )
        return 2
    except Exception as e:
        log.error("Failed to load %s: %s", config_path, e)
        return 2

    if not cfg.cameras:
        log.error("No cameras configured in %s", config_path)
        return 2

    db_dsn = cfg.database.dsn()
    init_db(db_dsn)
    log.info("Connected to database at %s:%s/%s", cfg.database.host, cfg.database.port, cfg.database.dbname)

    shutdown = Event()

    def handle_signal(signum, _frame):
        log.info("Signal %s received; shutting down", signum)
        shutdown.set()

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    global_cfg = _global_cfg_dict(cfg)
    processes: list[Process] = []
    for cam in cfg.cameras:
        p = _spawn(cam, global_cfg, db_dsn, shutdown)
        processes.append(p)
        log.info("Started worker '%s' (pid=%s)", cam.name, p.pid)

    # Supervise: poll every second, restart dead workers until shutdown.
    try:
        while not shutdown.is_set():
            shutdown.wait(timeout=1.0)
            if shutdown.is_set():
                break
            for i, p in enumerate(processes):
                if not p.is_alive():
                    cam = cfg.cameras[i]
                    log.error(
                        "Worker '%s' died (exitcode=%s); restarting",
                        p.name, p.exitcode,
                    )
                    processes[i] = _spawn(cam, global_cfg, db_dsn, shutdown)
    finally:
        log.info("Terminating workers...")
        for p in processes:
            if p.is_alive():
                p.terminate()
        for p in processes:
            p.join(timeout=5.0)
            if p.is_alive():
                log.warning("Force-killing %s", p.name)
                p.kill()
        log.info("Shutdown complete")

    return 0


if __name__ == "__main__":
    sys.exit(main())
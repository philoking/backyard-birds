"""Typed YAML config loader for BirdListener."""
from __future__ import annotations

import os
from typing import List, Optional
from urllib.parse import quote_plus

import yaml
from pydantic import BaseModel, Field, field_validator


class Location(BaseModel):
    latitude: float
    longitude: float


class DatabaseConfig(BaseModel):
    host: str
    port: int = 5432
    dbname: str = "birdlistener"
    user: str
    password: str = ""

    def dsn(self) -> str:
        password = os.environ.get("DB_PASSWORD") or self.password
        return (
            f"postgresql://{quote_plus(self.user)}:{quote_plus(password)}"
            f"@{self.host}:{self.port}/{self.dbname}"
        )


class CameraConfig(BaseModel):
    name: str
    rtsp_url: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None

    @field_validator("name")
    @classmethod
    def _name_safe(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("camera name must not be empty")
        return v


class AppConfig(BaseModel):
    min_confidence: float = Field(0.7, ge=0.0, le=1.0)
    sensitivity: float = Field(1.0, ge=0.5, le=1.5)
    overlap_seconds: float = Field(0.0, ge=0.0, lt=3.0)
    # Audio-clip capture: store the analyzed window for recent detections so the
    # dashboard can play back what was heard.
    save_clips: bool = True
    clip_keep: int = Field(5, ge=1, le=50)
    clip_min_interval_seconds: float = Field(30.0, ge=0.0)
    # Lead-in / lead-out padding around the 3s detection window so calls near a
    # window edge aren't clipped.
    clip_pad_before_seconds: float = Field(1.5, ge=0.0, le=10.0)
    clip_pad_after_seconds: float = Field(1.5, ge=0.0, le=10.0)
    default_location: Optional[Location] = None
    database: DatabaseConfig
    cameras: List[CameraConfig] = Field(default_factory=list)

    def effective_location(self, cam: CameraConfig) -> Optional[Location]:
        """Return the location that should be used for a given camera,
        preferring per-camera overrides over the global default."""
        if cam.latitude is not None and cam.longitude is not None:
            return Location(latitude=cam.latitude, longitude=cam.longitude)
        return self.default_location


def load_config(path: str) -> AppConfig:
    with open(path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}
    return AppConfig(**raw)

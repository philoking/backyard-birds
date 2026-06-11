# BirdListener - Continuous bird-call detection from RTSP IP cameras
#
# Uses ffmpeg to pull audio from Amcrest/generic RTSP streams and BirdNET
# (via birdnetlib) to identify species. Detections are logged to TimescaleDB.
FROM python:3.11-slim

# ffmpeg for RTSP audio ingest, libsndfile1 for librosa/soundfile, tzdata for
# accurate per-detection timestamps.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg \
        libsndfile1 \
        tzdata \
        ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download BirdNET model files at build time so first-run is instant and
# the container can start offline. birdnetlib ships the model inside the wheel,
# but this warms any caches.
RUN python -c "from birdnetlib.analyzer import Analyzer; Analyzer()" || true

COPY src/ ./src/

ENV PYTHONUNBUFFERED=1 \
    CONFIG_PATH=/app/config.yaml

CMD ["python", "-m", "src.main"]
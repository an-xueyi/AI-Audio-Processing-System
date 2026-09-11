FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# ffmpeg reads and writes audio formats. The compiler and Rust packages build
# Python dependencies that do not publish a ready-made ARM64 Linux wheel.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    ffmpeg \
    build-essential \
    rustc \
    cargo \
    pkg-config \
    libopus-dev \
    && rm -rf /var/lib/apt/lists/*

# requirements.txt refers to requirements-common.txt, so both must exist in the
# image before pip resolves the complete Linux dependency set. The glob also
# copies requirements-macos.txt as harmless documentation of the native setup.
COPY requirements*.txt ./

RUN pip install --no-cache-dir -r requirements.txt

# Create a service account that cannot administer the container operating
# system. A compromised audio decoder or model process therefore receives the
# worker's limited permissions instead of root privileges.
RUN groupadd --system audio-worker \
    && useradd --system \
    --gid audio-worker \
    --create-home \
    --home-dir /home/audio-worker \
    audio-worker

# HOME tells PyTorch and Demucs where this account's persistent model cache
# lives. Docker Compose mounts the named cache volume at the same directory.
ENV HOME=/home/audio-worker

# The service account owns application files so Python can read them without
# granting it permission to modify system packages or operating-system files.
COPY --chown=audio-worker:audio-worker *.py ./

USER audio-worker

CMD ["python", "main.py"]

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

COPY requirements.txt ./

RUN pip install --no-cache-dir -r requirements.txt

COPY *.py ./

CMD ["python", "main.py"]

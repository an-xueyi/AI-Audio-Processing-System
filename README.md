# Distributed AI Audio Processing System

A distributed web application that separates an uploaded song into six audio stems with Demucs. The system sends large audio files directly to S3-compatible object storage, processes jobs asynchronously through Kafka workers, and delivers live progress and temporary download links through WebSockets.

## Using the Application

1. Select an MP3, WAV, FLAC, M4A, AAC, or OGG audio file.
2. Choose **Upload and Create Job**.
3. Follow the live processing status and percentage.
4. Cancel an active job when processing is no longer needed.
5. Download the completed vocals, drums, bass, guitar, piano, and other stems.

Download URLs are temporary. Uploaded files and processing jobs are isolated by a signed browser session.

## Architecture

```text
Browser
  |-- request temporary upload permission --> Express API
  |<-- presigned S3-compatible URL ----------|
  |-- upload audio directly ----------------> MinIO
  |-- create processing job ----------------> Express API
                                                  |
                                   PostgreSQL job + outbox event
                                                  |
                                           Outbox publisher
                                                  |
                                                  v
                                                Kafka
                                                  |
                                       Python worker group
                                                  |
                                  Demucs six-stem separation
                                                  |
                              PostgreSQL status + MinIO results
                                                  |
                         Kafka status event -> Express WebSocket
                                                  |
Browser <-------------- live progress and completion ------------|
```

The backend stores a job and its Kafka event in one PostgreSQL transaction. A background outbox publisher sends committed events to Kafka, preventing a successful database write from losing its processing event.

Workers use leases and heartbeats so only one worker owns a job at a time. Kafka offsets are committed only after a job reaches a terminal state or is intentionally skipped. Failed jobs retry with backoff before being sent to a dead-letter topic.

## Current Features

- Direct browser-to-object-storage uploads with temporary presigned URLs
- Audio type, extension, ownership, and size validation
- Session-based job isolation and temporary result download URLs
- PostgreSQL transactional outbox for reliable Kafka publishing
- Horizontally scalable Kafka consumer workers
- Idempotent job claims with worker leases and heartbeats
- Demucs `htdemucs_6s` separation on CPU
- Live segment-based progress through Kafka and WebSockets
- Cancellable processing with child-process termination
- WebSocket reconnection with polling fallback
- Retry backoff and dead-letter events for failed jobs
- Docker health checks, persistent volumes, and graceful shutdown

## Technology

- Frontend: React, TypeScript, Vite
- API: Node.js, Express, TypeScript
- Worker: Python, Demucs, PyTorch
- Messaging: Apache Kafka
- Database: PostgreSQL
- Object storage: MinIO using the S3 API
- Realtime communication: WebSockets
- Local infrastructure: Docker Compose

## Project Structure

```text
backend/
  sql/                 PostgreSQL schema migrations
  src/routes/          HTTP request validation and responses
  src/services/        Job transactions and object-storage operations
  src/kafka/           Producers, consumers, topics, and outbox publishing
  src/websocket/       Connections, subscriptions, and job notifications

frontend/src/
  api/                 HTTP requests to the backend and object storage
  components/          Visible interface sections
  hooks/               React state and application workflows
  realtime/            WebSocket reconnection and polling fallback

worker/
  main.py              Kafka consumer lifecycle and graceful shutdown
  job_handler.py       Claims, leases, retries, and dead-letter handling
  processing.py        Audio-processing stages and result uploads
  demucs_process.py    Cancellable Demucs child-process supervision
  demucs_runner.py     Demucs model execution and progress events
  database.py          PostgreSQL job and outbox updates
  storage.py           MinIO downloads and result uploads
```

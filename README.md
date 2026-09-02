# Distributed AI Audio Processing System

A distributed web application for separating an uploaded song into vocals, drums, bass, guitar, piano, and other audio stems with Demucs. Large files travel directly from the browser to private S3-compatible object storage, while Kafka and containerized Python workers handle the machine-learning workload independently from the web application.

The interface provides live processing progress, job recovery after a page refresh, cancellation controls, account-based history, and temporary download links for completed stems.

## Using the Application

1. Create an account, sign in, or continue with a private visitor session.
2. Select an MP3, WAV, FLAC, M4A, AAC, or OGG audio file.
3. Choose **Upload and Create Job**.
4. Follow the live processing status and percentage.
5. Cancel an active job when processing is no longer needed.
6. Download the completed vocals, drums, bass, guitar, piano, and other stems.

Download URLs are temporary. Signed-in users can recover their job history from another browser, while visitors receive an isolated signed browser session. Private uploads and generated stems expire automatically after the configured retention period, while retained job history remains visible to its owner.

Account settings allow a signed-in user to change the password, review active browser sessions, sign out other browsers, or permanently delete the account. Account deletion cancels active processing and schedules owned private audio and job records for removal.

## How Processing Works

1. The browser asks the backend for a short-lived presigned upload URL.
2. The browser uploads the audio file directly to object storage instead of sending the large file through the backend server.
3. The backend creates a PostgreSQL job and a matching outbox event in one database transaction.
4. The outbox publisher sends the committed job event to Kafka.
5. An available Python worker claims the job and runs Demucs stem separation.
6. The worker stores progress and result locations in PostgreSQL and publishes status events through Kafka.
7. A backend replica forwards each update to the correct browser through WebSockets.
8. After completion, the browser requests temporary signed links for downloading the separated stems.

This asynchronous design keeps uploads and machine-learning processing away from ordinary API requests. The frontend can continue responding even when a worker is processing a long audio file or another worker is recovering interrupted work.

## Architecture

```text
Browser
  |-- HTTP and WebSocket requests --> Nginx load balancer
  |                                      |
  |                              Backend replica pool
  |                                      |
  |                         PostgreSQL job + outbox event
  |                                      |
  |                               Outbox publisher
  |                                      v
  |                                    Kafka
  |                                      |
  |                           Python worker group
  |                                      |
  |                         Demucs six-stem separation
  |                                      |
  |                     PostgreSQL status + MinIO results
  |                                      |
  |              Kafka status event -> backend WebSocket
  |                                      |
  |<----------- live progress and completion
  |
  |-- presigned direct audio upload ----------------> MinIO
```

The backend stores a job and its Kafka event in one PostgreSQL transaction. A background outbox publisher sends committed events to Kafka, preventing a successful database write from losing its processing event.

Workers use leases and heartbeats so only one worker owns a job at a time. Kafka offsets are committed only after a job reaches a terminal state or is intentionally skipped. Failed jobs retry with backoff before being sent to a dead-letter topic.

## Reliability and Privacy

- Every job belongs to either an authenticated account or an isolated visitor session.
- Backend job, cancellation, download, and WebSocket operations verify that ownership before returning private information.
- Passwords are stored as salted hashes, and authentication uses revocable server-side sessions rather than browser-stored account credentials.
- Presigned upload and download URLs expire automatically and grant access only to a specific object operation.
- The transactional outbox keeps a committed database job from losing its Kafka processing event.
- Worker leases, heartbeats, idempotent claims, and retry backoff support recovery from interrupted processing.
- Original uploads and generated stems are deleted after their retention deadline or when their owner deletes the account.
- Secrets and service credentials are supplied through ignored environment files and are not stored in the repository.

## Current Features

- Direct browser-to-object-storage uploads with temporary presigned URLs
- Audio type, extension, ownership, and size validation
- Account or visitor-session job isolation and temporary result download URLs
- Cross-browser account history and active-job recovery after a page refresh
- Password hashing, revocable server-side sessions, and account management
- Automatic expiration and deletion of private source audio and generated stems
- PostgreSQL transactional outbox for reliable Kafka publishing
- Nginx load balancing across horizontally scalable backend replicas
- Horizontally scalable Kafka consumer workers
- Idempotent job claims with worker leases and heartbeats
- Demucs `htdemucs_6s` separation on CPU
- Live segment-based progress through Kafka and WebSockets
- Cancellable processing with child-process termination
- WebSocket reconnection with polling fallback
- Retry backoff and dead-letter events for failed jobs
- Docker health checks, persistent volumes, and graceful shutdown
- Ordered database migrations and an independently running storage-cleanup service

## Technology

- Frontend: React, TypeScript, Vite
- API: Node.js, Express, TypeScript
- Worker: Python, Demucs, PyTorch
- Messaging: Apache Kafka
- Database: PostgreSQL
- Object storage: MinIO using the S3 API
- Realtime communication: WebSockets
- Reverse proxy and load balancer: Nginx
- Local infrastructure: Docker Compose

## Project Structure

```text
backend/
  sql/                 PostgreSQL schema migrations
  src/auth/            Password, account, principal, and session security
  src/routes/          HTTP request validation and responses
  src/services/        Job transactions and object-storage operations
  src/cleanup.ts       Expired object cleanup process and graceful shutdown
  src/kafka/           Producers, consumers, topics, and outbox publishing
  src/websocket/       Connections, subscriptions, and job notifications

nginx/
  nginx.conf           HTTP and WebSocket load balancing for backend replicas

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

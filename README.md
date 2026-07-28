# Distributed AI Audio Processing System

A full-stack distributed audio processing system that uploads audio files to S3-compatible object storage, creates asynchronous processing jobs, sends job events through Kafka, processes jobs in a Python worker, and streams job status updates to the frontend through WebSockets.

## Tech Stack

- Frontend: React, TypeScript, Vite
- Backend API: Node.js, Express, TypeScript
- Worker: Python
- Database: PostgreSQL
- Object Storage: MinIO, S3-compatible
- Message Queue: Kafka
- Realtime Updates: WebSocket
- Local Infrastructure: Docker Compose

## Architecture

```text
Frontend
  |
  | 1. Request presigned upload URL
  v
Backend API
  |
  | 2. Return temporary upload URL
  v
MinIO / S3

Frontend uploads audio directly to MinIO

Frontend
  |
  | 3. Create processing job with uploaded object key
  v
Backend API
  |
  | 4. Save job in PostgreSQL
  | 5. Publish job-created event
  v
Kafka
  |
  | 6. Worker consumes job event
  v
Python Worker
  |
  | 7. Update job status
  | 8. Create mock result files
  | 9. Upload results to MinIO
  v
PostgreSQL + MinIO

Backend sends job status updates to the frontend through WebSocket.
Frontend requests temporary download URLs when the job is complete.
```

## Current Features

- Direct-to-object-storage upload flow using presigned URLs
- Job creation and lookup API
- PostgreSQL job tracking
- Kafka job event publishing
- Python Kafka consumer worker
- Mock audio result generation
- Result file upload to MinIO
- Presigned result download URLs
- Frontend upload and job creation flow
- WebSocket job status updates

## Local Setup

### 1. Start The Docker Services

From the project root:

```bash
docker compose up -d --build
```

This starts the local backend system:

- Express backend API
- Python worker
- PostgreSQL database
- MinIO object storage
- Kafka message broker
- Kafka topic initialization container

The `kafka-init` container automatically creates the Kafka topic:

```text
audio.jobs.created
```

### 2. Check Running Containers

```bash
docker compose ps
```

You should see services like:

```text
audio-backend
audio-worker
audio-postgres
audio-minio
audio-kafka
```

The `audio-kafka-init` container may show as exited. That is expected because it only runs once to create the Kafka topic.

### 3. Check Backend Health

```bash
curl http://localhost:4000/health
```

You should receive a JSON response from the backend.

Check database connectivity:

```bash
curl http://localhost:4000/db-health
```

You should see that the backend can connect to PostgreSQL.

### 4. Start The Frontend

Open a new terminal:

```bash
cd frontend
npm install
npm run dev
```

Then open:

```text
http://localhost:5173
```

Use the page to choose an audio file, upload it, create a processing job, watch status updates, and download generated result files.

### 5. Stop The Project

To stop containers without deleting data:

```bash
docker compose stop
```

To stop and remove containers/networks without deleting stored PostgreSQL or MinIO data:

```bash
docker compose down
```

Do not use this unless you intentionally want to delete local stored data:

```bash
docker compose down -v
```

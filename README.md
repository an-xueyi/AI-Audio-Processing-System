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

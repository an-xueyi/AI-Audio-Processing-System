# Distributed AI Audio Processing System

A full-stack distributed audio processing system that uploads audio files to S3-compatible object storage, creates asynchronous processing jobs, sends job events through Kafka, processes jobs in a Python worker, and streams job status updates to the frontend through WebSockets.

This project is currently built as a local production-style prototype. The worker generates mock result files for now; the next major ML upgrade is replacing the mock processing step with Demucs-based stem separation.

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

### 1. Start Infrastructure

From the project root:

```bash
docker compose up -d
```

This starts PostgreSQL, MinIO, and Kafka in the background.

Check running containers:

```bash
docker ps
```

You should see:

```text
audio-postgres
audio-minio
audio-kafka
```

### 2. Create Kafka Topic

Kafka needs the `audio.jobs.created` topic before the worker can consume job messages.

```bash
docker exec audio-kafka /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server localhost:9092 \
  --create \
  --if-not-exists \
  --topic audio.jobs.created \
  --partitions 1 \
  --replication-factor 1
```

Verify the topic exists:

```bash
docker exec audio-kafka /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server localhost:9092 \
  --list
```

You should see:

```text
audio.jobs.created
```

### 3. Backend Setup

Open a new terminal:

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

The backend runs at:

```text
http://localhost:4000
```

Health check:

```bash
curl http://localhost:4000/health
```

Database health check:

```bash
curl http://localhost:4000/db-health
```

### 4. Worker Setup

Open a new terminal:

```bash
cd worker
cp .env.example .env
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py
```

The worker listens for Kafka messages from:

```text
audio.jobs.created
```

When a job is created, the worker updates the job status, creates mock output files, uploads those results to MinIO, and marks the job as complete.

### 5. Frontend Setup

Open a new terminal:

```bash
cd frontend
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

Use the page to choose an audio file, upload it, create a job, watch status updates, and download mock result files.

## MinIO Console

Open:

```text
http://localhost:9001
```

Default local credentials:

```text
Username: minioadmin
Password: minioadmin123
```

Bucket:

```text
audio-processing
```

Uploaded input files appear under:

```text
uploads/
```

Mock worker outputs appear under:

```text
results/
```

## Useful Development Commands

Start all Docker infrastructure:

```bash
docker compose up -d
```

Stop Docker infrastructure without deleting data:

```bash
docker compose stop
```

Run backend build check:

```bash
cd backend
npm run build
```

Run frontend build check:

```bash
cd frontend
npm run build
```

Run Python syntax check:

```bash
cd worker
source .venv/bin/activate
python -m py_compile main.py
```

## Development Notes

This project currently uses mock worker output files instead of real AI stem separation. The system architecture is designed so the mock worker processing step can later be replaced with real Demucs processing.

Local `.env` files are intentionally ignored by Git. Use `.env.example` files as templates.

## Future Improvements

- Integrate Demucs for real audio stem separation
- Dockerize backend and worker services
- Add stronger validation and centralized error handling
- Add user authentication
- Add cloud deployment support
- Replace local MinIO with AWS S3 in production

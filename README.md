# Distributed AI Audio Processing System

A distributed audio processing platform that accepts large audio uploads, stores them in S3-compatible object storage, queues background processing jobs through Kafka, and returns processed audio stems to users through real-time status updates.

## Planned Architecture

- Frontend: React + Vite
- Backend API: Node.js + Express
- Worker: Python
- Queue: Kafka
- Database: PostgreSQL
- Object Storage: MinIO locally, AWS S3 later
- Realtime Updates: WebSocket

## Development Phases

1. Project skeleton
2. Backend health API
3. PostgreSQL job table
4. MinIO presigned upload flow
5. Kafka job queue
6. Python worker
7. Frontend upload page
8. WebSocket progress updates
9. Demucs integration
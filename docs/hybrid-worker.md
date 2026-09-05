# Hybrid Worker Operation

This deployment shape keeps the web-facing control system online while Demucs
runs on a local Mac. The frontend, Express backend, PostgreSQL, Kafka, and
S3-compatible storage are online. The Python worker connects outward to those
services and does not require an inbound port on the home network.

## Message and Data Flow

1. A browser uploads audio directly to online S3-compatible storage through a
   short-lived presigned URL.
2. The online backend stores a job in PostgreSQL and publishes its event to the
   online Kafka broker.
3. The local worker opens outbound TLS connections to Kafka, PostgreSQL, and
   object storage.
4. Kafka delivers the waiting job to the worker when the Mac is online.
5. The worker downloads the private source audio, runs Demucs locally, uploads
   the stems, and writes progress to online PostgreSQL.
6. The online backend delivers progress and completion to the browser through
   WebSockets.

When the local worker is stopped, the website remains available. New jobs remain
`PENDING` in Kafka and PostgreSQL until the worker reconnects. The frontend's
System Status section reports that processing is offline instead of presenting
the control system as broken.

## Local Control-Plane Simulation

If the ordinary all-in-Docker stack is already running, first stop its worker:

```bash
docker compose stop worker
```

`stop worker` sends a graceful stop request only to the worker container. It
does not stop the web services and does not delete any Docker volume or audio.
This prevents an old container worker from processing the test job before the
Mac worker receives it.

Then run the following command from the repository root:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.control-plane.yml \
  up -d --build --scale backend=3
```

`-f` tells Compose to merge the normal configuration with the hybrid override.
The override places only the containerized worker behind an inactive profile, so
the remaining services start normally. It also exposes PostgreSQL port 5432 and
Kafka port 9092 only on `127.0.0.1`, which allows a Python process on this Mac to
reach them without exposing them to other computers. `-d` leaves the services
running in the background, `--build` rebuilds changed application images, and
`--scale backend=3` starts three API replicas behind Nginx.

The local worker can then be started in a separate terminal:

```bash
cd worker
source .venv/bin/activate
python main.py
```

`cd worker` enters the Python service directory. `source` activates that
directory's isolated Python packages. `python main.py` starts the long-running
Kafka consumer and worker heartbeat. Press `Control+C` to request a graceful
worker shutdown, and run `deactivate` after it stops to leave the virtual
environment.

To stop the local control-plane simulation without deleting stored Docker data:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.control-plane.yml \
  stop
```

`stop` turns off the containers but keeps PostgreSQL, Kafka, MinIO, and Demucs
cache volumes for the next run.

## Future Online Worker Configuration

Create `worker/.env` from `worker/.env.example`, but never commit that real file.
For a hybrid production worker, these values will come from the selected online
services:

```text
APP_ENV=production

KAFKA_BROKERS=managed-broker-one:port,managed-broker-two:port
KAFKA_SECURITY_PROTOCOL=SASL_SSL
KAFKA_SASL_MECHANISM=SCRAM-SHA-256
KAFKA_SASL_USERNAME=private-kafka-username
KAFKA_SASL_PASSWORD=private-kafka-password

DATABASE_URL=postgresql://user:password@host/database?sslmode=require

S3_ENDPOINT=https://private-s3-compatible-api
S3_REGION=provider-region
S3_ACCESS_KEY_ID=private-storage-key
S3_SECRET_ACCESS_KEY=private-storage-secret
S3_BUCKET=private-audio-bucket

PROCESSING_MODE=demucs
DEMUCS_MODEL=htdemucs_6s
```

These are placeholders, not working credentials. `APP_ENV=production` makes the
worker reject plaintext Kafka, an unencrypted PostgreSQL URL, or an HTTP storage
endpoint before it can consume a job. A provider may use `PLAIN`,
`SCRAM-SHA-256`, or `SCRAM-SHA-512`; its connection page supplies the exact
value. `KAFKA_SSL_CA_PATH` is necessary only when the broker uses a private TLS
certificate authority instead of a publicly trusted certificate.

The backend needs matching Kafka broker and SASL values because it publishes job
events and consumes worker status events. Credentials belong in the hosting
platform's private secret settings, never in Git, README examples, frontend
`VITE_` variables, logs, screenshots, or browser-visible responses.

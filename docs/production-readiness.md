# Production Readiness Audit

This audit covers changes that are independent of a particular cloud provider.
It does not select a host, create cloud resources, or contain real credentials.

## Ready

- The browser uploads audio directly through short-lived presigned object URLs.
- API, cancellation, download, and WebSocket paths enforce job ownership.
- Passwords are salted and hashed; opaque authentication tokens are hashed in
  PostgreSQL and delivered only through HTTP-only cookies.
- Production startup requires explicit HTTPS browser origins, Secure cookies,
  a browser-reachable HTTPS storage endpoint, and required service credentials.
- Local development keeps its existing HTTP localhost behavior through
  `APP_ENV=development`.
- The production frontend build defaults to same-origin HTTP and WebSocket URLs,
  avoiding hard-coded localhost addresses in deployed browser code.
- Nginx hides its version, limits unexpected request bodies, blocks internal
  operations endpoints, and forwards WebSocket upgrade headers.
- Backend containers run as the unprivileged `node` user.
- Workers validate database, Kafka, storage, and processing-mode configuration
  before joining a Kafka consumer group.
- PostgreSQL, Kafka, MinIO, and backend replicas are not directly published to
  external host interfaces by the local Compose configuration.
- Application errors return a request ID without returning stack traces.

## Requires a Hosting Decision

The following settings depend on the future host and should not be guessed now:

- Public domain name and DNS records
- TLS certificate creation or platform-managed HTTPS termination
- Public frontend origin used by `CORS_ALLOWED_ORIGINS`
- Browser-reachable object-storage address used by `S3_PUBLIC_ENDPOINT`
- Persistent volume locations, backup policy, and restoration procedure
- CPU and memory allocations for Demucs, Kafka, PostgreSQL, and MinIO
- Container image registry, immutable image tags, and deployment commands
- Whether one machine or multiple machines provide the public deployment

## Production Environment Rules

A future production environment must use:

```text
APP_ENV=production
COOKIE_SECURE=true
CORS_ALLOWED_ORIGINS=https://the-public-application-origin
S3_PUBLIC_ENDPOINT=https://the-browser-reachable-storage-origin
```

All database passwords, storage credentials, and session secrets must remain in
the host's private secret configuration. They must never be placed in a Vite
variable because every `VITE_` value is included in the public browser bundle.

# Local Distributed-System Verification

These programs verify the running Docker Compose system through its real HTTP,
Kafka, PostgreSQL, MinIO, and worker paths. They are local operational checks,
not browser features and not part of the deployed public API.

## Safety

Both programs refuse to start when they detect an active job, a busy worker, a
pending job-created outbox event, or unread job messages in Kafka. Run them only
against the local Docker Compose environment.

Temporary jobs use a separate signed session. Their storage expiration is moved
to the present after verification so the normal cleanup service removes their
private inputs and results. Test teardown restores one worker in Demucs mode.

## Concurrent Distribution

```bash
node scripts/integration/verify-distributed-processing.mjs
```

This starts three mock workers, submits nine direct-upload jobs, and verifies one
processing attempt, one completion event, and one Kafka offset commit per job.
It also confirms that more than one worker completed jobs.

Set `INTEGRATION_JOB_COUNT` to an integer from 3 through 30 to change the batch:

```bash
INTEGRATION_JOB_COUNT=12 \
node scripts/integration/verify-distributed-processing.mjs
```

## Forced Worker Recovery

```bash
node scripts/integration/verify-worker-recovery.mjs
```

This deliberately force-removes the container processing one temporary job. It
waits for the 60-second job lease to expire, verifies that another worker claims
the job, and requires exactly two durable processing attempts before completion.
The complete check normally takes about two minutes.

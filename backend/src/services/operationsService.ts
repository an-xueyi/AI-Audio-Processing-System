/* Build a secret-free operational snapshot from durable PostgreSQL state. */
import { pool } from "../db.js";

type CountRow = {
  status: string;
  count: string;
};

type QueueRow = {
  pending_outbox_events: string;
  oldest_pending_seconds: string | null;
  expired_storage_waiting: string;
  cleanup_failures_waiting: string;
};

type WorkerRow = {
  active_workers: string;
  idle_workers: string;
  busy_workers: string;
  recently_stale_workers: string;
};

export function parseWorkerCounts(row: WorkerRow) {
  // PostgreSQL aggregate counts arrive as text. Convert them in one small pure
  // function so both the response and automated tests use identical rules.
  return {
    active: Number(row.active_workers),
    idle: Number(row.idle_workers),
    busy: Number(row.busy_workers),
    recentlyStale: Number(row.recently_stale_workers),
  };
}

export async function getDurableOperationsSnapshot() {
  // These independent read-only queries can run concurrently on pool connections.
  const [jobResult, queueResult, workerResult] = await Promise.all([
    pool.query<CountRow>(
      `SELECT status, COUNT(*)::text AS count
       FROM jobs
       GROUP BY status
       ORDER BY status`,
    ),
    pool.query<QueueRow>(
      `SELECT
         COUNT(*) FILTER (
           WHERE status = 'PENDING'
         )::text AS pending_outbox_events,
         EXTRACT(EPOCH FROM (NOW() - MIN(created_at) FILTER (
           WHERE status = 'PENDING'
         )))::text AS oldest_pending_seconds,
         (
           SELECT COUNT(*)::text
           FROM jobs
           WHERE storage_expires_at <= NOW()
             AND storage_deleted_at IS NULL
         ) AS expired_storage_waiting,
         (
           SELECT COUNT(*)::text
           FROM jobs
           WHERE cleanup_error_message IS NOT NULL
             AND storage_deleted_at IS NULL
         ) AS cleanup_failures_waiting
       FROM outbox_events`,
    ),
    pool.query<WorkerRow>(
      `SELECT
         COUNT(*) FILTER (
           WHERE last_heartbeat_at >= NOW() - (
             heartbeat_timeout_seconds * INTERVAL '1 second'
           )
         )::text AS active_workers,
         COUNT(*) FILTER (
           WHERE status = 'IDLE'
             AND last_heartbeat_at >= NOW() - (
               heartbeat_timeout_seconds * INTERVAL '1 second'
             )
         )::text AS idle_workers,
         COUNT(*) FILTER (
           WHERE status = 'BUSY'
             AND last_heartbeat_at >= NOW() - (
               heartbeat_timeout_seconds * INTERVAL '1 second'
             )
         )::text AS busy_workers,
         COUNT(*) FILTER (
           WHERE last_heartbeat_at < NOW() - (
             heartbeat_timeout_seconds * INTERVAL '1 second'
           )
             AND last_heartbeat_at >= NOW() - INTERVAL '24 hours'
         )::text AS recently_stale_workers
       FROM worker_instances`,
    ),
  ]);

  const jobCounts: Record<string, number> = {};

  for (const row of jobResult.rows) {
    // PostgreSQL COUNT arrives as text because it can exceed JavaScript integers.
    // Operational counts here are expected to remain within ordinary number size.
    jobCounts[row.status] = Number(row.count);
  }

  const queues = queueResult.rows[0];

  if (!queues) {
    throw new Error("PostgreSQL did not return the operations aggregate");
  }

  const workers = workerResult.rows[0];

  if (!workers) {
    throw new Error("PostgreSQL did not return the worker aggregate");
  }

  return {
    jobCounts,
    pendingOutboxEvents: Number(queues.pending_outbox_events),
    oldestPendingOutboxSeconds:
      queues.oldest_pending_seconds === null
        ? null
        : Math.round(Number(queues.oldest_pending_seconds)),
    expiredStorageWaiting: Number(queues.expired_storage_waiting),
    cleanupFailuresWaiting: Number(queues.cleanup_failures_waiting),
    // Return totals only. Worker IDs and current job IDs stay inside PostgreSQL.
    workers: parseWorkerCounts(workers),
  };
}

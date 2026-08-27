/* Keep PostgreSQL job operations and their transaction rules in one module. */
import { pool } from "../db.js";
import { resultRetentionHours } from "../config/retention.js";
import { jobCreatedTopic, jobStatusTopic } from "../kafka/topics.js";

// JobRecord describes one row returned from the jobs table. Snake_case names
// intentionally match PostgreSQL column names exactly.
export type JobRecord = {
  id: string;
  original_file_name: string;
  input_object_key: string;
  status: string;
  progress: number;
  result_object_keys: Record<string, string> | null;
  error_message: string | null;
  storage_expires_at: Date | null;
  storage_deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

// Reusing this list keeps SELECT and RETURNING results consistent across methods.
const jobColumns = `id, original_file_name, input_object_key, status, progress,
  result_object_keys, error_message, storage_expires_at, storage_deleted_at,
  created_at, updated_at`;

// Limit one history response so a long-lived browser session cannot make the API
// load and serialize an unlimited number of old jobs in a single request.
export const jobHistoryLimit = 20;

export async function createJob(
  ownerId: string,
  originalFileName: string,
  inputObjectKey: string,
): Promise<JobRecord> {
  // Reserve one connection from the shared pool for this complete transaction.
  const client = await pool.connect();

  try {
    // BEGIN groups later statements into one all-or-nothing database transaction.
    await client.query("BEGIN");

    // $1, $2, and $3 are PostgreSQL placeholders. The separate values array lets
    // pg escape user data safely instead of inserting it into SQL source text.
    const result = await client.query<JobRecord>(
      `INSERT INTO jobs
       (owner_id, original_file_name, input_object_key, status, progress)
       VALUES ($1, $2, $3, 'PENDING', 0)
       RETURNING ${jobColumns}`,
      [ownerId, originalFileName, inputObjectKey],
    );
    // RETURNING places the inserted row in rows; this INSERT should return one.
    const job = result.rows[0];

    if (!job) {
      throw new Error("PostgreSQL did not return the created job");
    }

    /*
     * PostgreSQL cannot participate directly in the same transaction as Kafka.
     * Writing the job and an outbox row in one database transaction closes the
     * dangerous gap between "job saved" and "Kafka event sent." After COMMIT,
     * a background publisher repeatedly sends pending outbox rows to Kafka. If
     * the database transaction rolls back, neither record exists; if Kafka is
     * temporarily unavailable, the durable outbox row remains available.
     */
    await client.query(
      `INSERT INTO outbox_events (topic, event_key, payload)
       VALUES ($1, $2, $3::jsonb)`,
      [
        jobCreatedTopic,
        job.id,
        JSON.stringify({
          jobId: job.id,
          inputObjectKey: job.input_object_key,
          originalFileName: job.original_file_name,
        }),
      ],
    );

    // COMMIT makes both the job and outbox event durable and visible together.
    await client.query("COMMIT");
    return job;
  } catch (error) {
    // Any error cancels every uncommitted statement from this transaction.
    await client.query("ROLLBACK");

    // Re-throw so the Express error handler can log and report the failure.
    throw error;
  } finally {
    // finally always runs. release returns this connection to the pool for reuse.
    client.release();
  }
}

// A discriminated union lists every expected cancellation outcome. Callers check
// `outcome` and TypeScript then knows which additional fields are available.
export type CancelJobResult =
  | { outcome: "cancelled"; job: JobRecord }
  | { outcome: "not_found" }
  | { outcome: "not_cancellable"; status: string };

export async function cancelJob(
  jobId: string,
  ownerId: string,
): Promise<CancelJobResult> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // The WHERE clause combines identity, ownership, and current-state checks in
    // the UPDATE itself. This prevents a race between checking and cancelling.
    const result = await client.query<JobRecord>(
      `UPDATE jobs
       SET status = 'CANCELLED',
           processing_worker_id = NULL,
           processing_heartbeat_at = NULL,
           error_message = NULL,
           storage_expires_at = COALESCE(
             storage_expires_at,
             NOW() + ($3 * INTERVAL '1 hour')
           ),
           updated_at = NOW()
       WHERE id = $1
         AND owner_id = $2
         AND status IN ('PENDING', 'PROCESSING', 'RETRYING')
       RETURNING ${jobColumns}`,
      // A cancelled job no longer needs its uploaded source forever. The same
      // configured retention period used for completed results applies here.
      [jobId, ownerId, resultRetentionHours],
    );
    // No returned row means the job was absent, belonged to someone else, or had
    // already reached a status that cannot be cancelled.
    const job = result.rows[0];

    if (!job) {
      // Nothing changed, so this transaction has no useful work to commit.
      await client.query("ROLLBACK");

      // A second ownership-filtered query distinguishes "not found" from a job
      // that exists but is already terminal.
      const existingJob = await client.query<{ status: string }>(
        "SELECT status FROM jobs WHERE id = $1 AND owner_id = $2",
        [jobId, ownerId],
      );
      // Optional chaining returns undefined when the query returned no row.
      const existingStatus = existingJob.rows[0]?.status;

      // This ternary creates the matching result shape for the route handler.
      return existingStatus
        ? { outcome: "not_cancellable", status: existingStatus }
        : { outcome: "not_found" };
    }

    // Enqueue a status notification in the same cancellation transaction so
    // every backend replica can refresh its connected browser clients.
    await client.query(
      `INSERT INTO outbox_events (topic, event_key, payload)
       VALUES ($1, $2, jsonb_build_object('jobId', $2::text))`,
      [jobStatusTopic, jobId],
    );

    await client.query("COMMIT");
    return { outcome: "cancelled", job };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function findOwnedJob(
  jobId: string,
  ownerId: string,
): Promise<JobRecord | null> {
  // owner_id is part of the query rather than checked afterward, so another
  // session's job row is never returned to application code.
  const result = await pool.query<JobRecord>(
    `SELECT ${jobColumns}
     FROM jobs
     WHERE id = $1 AND owner_id = $2`,
    [jobId, ownerId],
  );

  // Nullish coalescing changes an absent first row (undefined) into the explicit
  // null promised by this function's return type.
  return result.rows[0] ?? null;
}

export async function findRecentOwnedJobs(
  ownerId: string,
): Promise<JobRecord[]> {
  /*
   * Return recent history directly from PostgreSQL instead of browser storage.
   * The signed session ID is the ownership key, so a page refresh can recover
   * jobs while a different browser session cannot read them.
   */
  const result = await pool.query<JobRecord>(
    `SELECT ${jobColumns}
     FROM jobs
     WHERE owner_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    // $1 safely supplies the verified owner UUID. $2 keeps the response bounded
    // without inserting the numeric limit directly into the SQL text.
    [ownerId, jobHistoryLimit],
  );

  // pg always returns an array for rows. It is empty when this session has never
  // created a job, so callers do not need a special null check.
  return result.rows;
}

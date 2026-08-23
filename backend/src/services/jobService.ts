import { pool } from "../db.js";
import { jobCreatedTopic, jobStatusTopic } from "../kafka/topics.js";

export type JobRecord = {
  id: string;
  original_file_name: string;
  input_object_key: string;
  status: string;
  progress: number;
  result_object_keys: Record<string, string> | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
};

const jobColumns = `id, original_file_name, input_object_key, status, progress,
  result_object_keys, error_message, created_at, updated_at`;

export async function createJob(
  ownerId: string,
  originalFileName: string,
  inputObjectKey: string,
): Promise<JobRecord> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await client.query<JobRecord>(
      `INSERT INTO jobs
       (owner_id, original_file_name, input_object_key, status, progress)
       VALUES ($1, $2, $3, 'PENDING', 0)
       RETURNING ${jobColumns}`,
      [ownerId, originalFileName, inputObjectKey],
    );
    const job = result.rows[0];

    if (!job) {
      throw new Error("PostgreSQL did not return the created job");
    }

    // The job and its Kafka event commit together. The outbox publisher can
    // safely retry Kafka without creating a job that has no corresponding event.
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

    await client.query("COMMIT");
    return job;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

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
    const result = await client.query<JobRecord>(
      `UPDATE jobs
       SET status = 'CANCELLED',
           processing_worker_id = NULL,
           processing_heartbeat_at = NULL,
           error_message = NULL,
           updated_at = NOW()
       WHERE id = $1
         AND owner_id = $2
         AND status IN ('PENDING', 'PROCESSING', 'RETRYING')
       RETURNING ${jobColumns}`,
      [jobId, ownerId],
    );
    const job = result.rows[0];

    if (!job) {
      await client.query("ROLLBACK");
      const existingJob = await client.query<{ status: string }>(
        "SELECT status FROM jobs WHERE id = $1 AND owner_id = $2",
        [jobId, ownerId],
      );
      const existingStatus = existingJob.rows[0]?.status;

      return existingStatus
        ? { outcome: "not_cancellable", status: existingStatus }
        : { outcome: "not_found" };
    }

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
  const result = await pool.query<JobRecord>(
    `SELECT ${jobColumns}
     FROM jobs
     WHERE id = $1 AND owner_id = $2`,
    [jobId, ownerId],
  );

  return result.rows[0] ?? null;
}

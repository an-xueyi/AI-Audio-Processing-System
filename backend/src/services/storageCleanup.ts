/* Claim expired jobs, delete their private objects, and record cleanup results. */
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { pool } from "../db.js";
import { bucketName, s3Client } from "../storage/s3.js";

type ClaimedCleanupJob = {
  id: string;
  input_object_key: string;
  result_object_keys: Record<string, string> | null;
  cleanup_claim_id: string;
};

export type CleanupBatchResult = {
  claimed: number;
  deleted: number;
  failed: number;
};

async function claimExpiredJobs(
  batchSize: number,
  claimTimeoutMinutes: number,
): Promise<ClaimedCleanupJob[]> {
  /*
   * FOR UPDATE SKIP LOCKED lets several cleanup processes inspect the same table
   * without waiting for or duplicating one another's rows. The CTE first chooses
   * candidates; the UPDATE then gives each candidate a unique claim UUID.
   */
  const result = await pool.query<ClaimedCleanupJob>(
    `WITH candidates AS (
       SELECT id
       FROM jobs
       WHERE storage_expires_at <= NOW()
         AND storage_deleted_at IS NULL
         AND (
           cleanup_claimed_at IS NULL
           OR cleanup_claimed_at <
              NOW() - ($2 * INTERVAL '1 minute')
         )
       ORDER BY storage_expires_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE jobs AS job
     SET cleanup_claim_id = gen_random_uuid(),
         cleanup_claimed_at = NOW(),
         cleanup_attempts = cleanup_attempts + 1,
         cleanup_error_message = NULL
     FROM candidates
     WHERE job.id = candidates.id
     RETURNING job.id,
               job.input_object_key,
               job.result_object_keys,
               job.cleanup_claim_id`,
    // PostgreSQL receives values separately from SQL source, preventing injection.
    [batchSize, claimTimeoutMinutes],
  );

  return result.rows;
}

async function collectObjectKeys(job: ClaimedCleanupJob): Promise<string[]> {
  // A Set removes accidental duplicate keys before asking object storage to delete.
  const objectKeys = new Set<string>([job.input_object_key]);

  // Failed and cancelled jobs normally have no result map, so the null check is
  // part of the expected path rather than an exceptional condition.
  if (job.result_object_keys) {
    for (const resultObjectKey of Object.values(job.result_object_keys)) {
      objectKeys.add(resultObjectKey);
    }
  }

  /*
   * A worker can fail after uploading one stem but before saving its complete
   * result map in PostgreSQL. Listing this job's isolated result prefix catches
   * those partial objects as well. ContinuationToken handles the unlikely case
   * where a custom model creates more than one S3 response page of files.
   */
  let continuationToken: string | undefined;

  do {
    const response = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: `results/${job.id}/`,
        ...(continuationToken
          ? { ContinuationToken: continuationToken }
          : {}),
      }),
    );

    for (const object of response.Contents || []) {
      if (object.Key) {
        objectKeys.add(object.Key);
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return [...objectKeys];
}

async function deleteJobObjects(job: ClaimedCleanupJob): Promise<void> {
  const objectKeys = await collectObjectKeys(job);

  // S3 accepts at most 1,000 keys per DeleteObjects request. Normal Demucs jobs
  // contain only a few files, but chunking keeps this correct for custom models.
  for (let start = 0; start < objectKeys.length; start += 1_000) {
    const objectKeyBatch = objectKeys.slice(start, start + 1_000);

    // Deleting an already-missing key succeeds, which makes crash recovery safe.
    const response = await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: {
          Objects: objectKeyBatch.map((Key) => ({ Key })),
          Quiet: true,
        },
      }),
    );

    // S3 may return HTTP success while reporting per-object failures in Errors.
    if (response.Errors && response.Errors.length > 0) {
      const failedKeys = response.Errors.map(
        (error) => error.Key || "unknown object",
      ).join(", ");

      throw new Error(`Object storage could not delete: ${failedKeys}`);
    }
  }
}

async function markCleanupCompleted(job: ClaimedCleanupJob): Promise<void> {
  const result = await pool.query(
    `UPDATE jobs
     SET storage_deleted_at = NOW(),
         cleanup_claim_id = NULL,
         cleanup_claimed_at = NULL,
         cleanup_error_message = NULL,
         updated_at = NOW()
     WHERE id = $1 AND cleanup_claim_id = $2`,
    [job.id, job.cleanup_claim_id],
  );

  // A zero-row update means the claim was replaced after timing out. The older
  // process must not mark work belonging to the newer cleanup attempt.
  if (result.rowCount !== 1) {
    throw new Error(`Cleanup claim was lost for job ${job.id}`);
  }
}

async function markCleanupFailed(
  job: ClaimedCleanupJob,
  error: unknown,
): Promise<void> {
  // Convert unknown thrown values to text and cap the database value so an SDK
  // diagnostic cannot create an unexpectedly large row.
  const errorMessage =
    error instanceof Error ? error.message : "Unknown storage cleanup error";

  await pool.query(
    `UPDATE jobs
     SET cleanup_claim_id = NULL,
         cleanup_claimed_at = NULL,
         cleanup_error_message = $3,
         updated_at = NOW()
     WHERE id = $1 AND cleanup_claim_id = $2`,
    [job.id, job.cleanup_claim_id, errorMessage.slice(0, 2_000)],
  );
}

export async function cleanupExpiredStorageBatch(
  batchSize: number,
  claimTimeoutMinutes: number,
): Promise<CleanupBatchResult> {
  const jobs = await claimExpiredJobs(batchSize, claimTimeoutMinutes);
  let deleted = 0;
  let failed = 0;

  // Process the bounded claims sequentially so one cleanup process generates only
  // one storage deletion request at a time. Horizontal instances may still work
  // concurrently because database claims prevent overlap.
  for (const job of jobs) {
    try {
      await deleteJobObjects(job);
      await markCleanupCompleted(job);
      deleted += 1;
      console.log(`Deleted expired storage for job ${job.id}`);
    } catch (error) {
      failed += 1;
      console.error(`Storage cleanup failed for job ${job.id}:`, error);
      await markCleanupFailed(job, error);
    }
  }

  return { claimed: jobs.length, deleted, failed };
}

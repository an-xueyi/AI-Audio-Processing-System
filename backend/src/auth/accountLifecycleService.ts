/* Change credentials and coordinate privacy-safe account deletion. */
import { pool } from "../db.js";
import { jobStatusTopic } from "../kafka/topics.js";

type StoredPassword = {
  password_hash: string;
};

export async function findPasswordHashForUser(
  userId: string,
): Promise<string | null> {
  const result = await pool.query<StoredPassword>(
    `SELECT password_hash
     FROM users
     WHERE id = $1`,
    [userId],
  );

  return result.rows[0]?.password_hash ?? null;
}

export async function changeUserPassword(
  userId: string,
  newPasswordHash: string,
  currentTokenHash: string,
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Store only the new scrypt representation and record when it changed.
    const userResult = await client.query(
      `UPDATE users
       SET password_hash = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [userId, newPasswordHash],
    );

    if (userResult.rowCount !== 1) {
      throw new Error("The account no longer exists");
    }

    // Keep the browser performing the password change signed in, but revoke every
    // other browser so an old copied session cannot survive the credential change.
    await client.query(
      `UPDATE user_sessions
       SET revoked_at = NOW()
       WHERE user_id = $1
         AND token_hash <> $2
         AND revoked_at IS NULL`,
      [userId, currentTokenHash],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteUserAccount(userId: string): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /*
     * Cancel every active job and notify backend replicas in the same database
     * transaction. Workers check the durable CANCELLED status and terminate their
     * Demucs child process instead of continuing expensive account-owned work.
     */
    await client.query(
      `WITH cancelled_jobs AS (
         UPDATE jobs
         SET status = 'CANCELLED',
             processing_worker_id = NULL,
             processing_heartbeat_at = NULL,
             error_message = NULL,
             updated_at = NOW()
         WHERE owner_id = $1
           AND status IN ('PENDING', 'PROCESSING', 'RETRYING')
         RETURNING id
       )
       INSERT INTO outbox_events (topic, event_key, payload)
       SELECT $2, id, jsonb_build_object('jobId', id::text)
       FROM cancelled_jobs`,
      [userId, jobStatusTopic],
    );

    // Make every owned source/result object eligible for immediate deletion. The
    // owner_deleted_at marker tells cleanup to remove the job row after S3/MinIO
    // confirms object deletion, while preserving retry information on failure.
    await client.query(
      `UPDATE jobs
       SET storage_expires_at = NOW(),
           owner_deleted_at = NOW(),
           updated_at = NOW()
       WHERE owner_id = $1`,
      [userId],
    );

    // Jobs whose storage was removed earlier need no further cleanup claim.
    await client.query(
      `DELETE FROM jobs
       WHERE owner_id = $1
         AND storage_deleted_at IS NOT NULL`,
      [userId],
    );

    // ON DELETE CASCADE removes every login session belonging to this user.
    const userResult = await client.query(
      `DELETE FROM users
       WHERE id = $1`,
      [userId],
    );

    if (userResult.rowCount !== 1) {
      throw new Error("The account no longer exists");
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

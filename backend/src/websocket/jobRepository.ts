import { pool } from "../db.js";

export async function findOwnedJob(jobId: string, sessionId: string) {
  const result = await pool.query(
    `SELECT id, original_file_name, input_object_key, status, progress,
            result_object_keys, error_message, created_at, updated_at
     FROM jobs
     WHERE id = $1 AND owner_id = $2`,
    [jobId, sessionId],
  );

  return result.rows[0] ?? null;
}

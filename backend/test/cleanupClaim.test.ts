/* Inspect the cleanup claim query without connecting to a real PostgreSQL server. */
import assert from "node:assert/strict";
import test from "node:test";

// The storage module validates required client settings during import. These are
// deliberately fake because this test replaces the database query and claims no
// rows, so no S3 request is sent.
process.env.S3_ENDPOINT = "http://127.0.0.1:9000";
process.env.S3_REGION = "us-east-1";
process.env.S3_ACCESS_KEY_ID = "test-access-key";
process.env.S3_SECRET_ACCESS_KEY = "test-secret-key";
process.env.S3_BUCKET = "test-bucket";

const { pool } = await import("../src/db.js");
const { cleanupExpiredStorageBatch } = await import(
  "../src/services/storageCleanup.js"
);

test("cleanup claims a bounded batch with non-blocking row locks", async () => {
  let capturedSql = "";
  let capturedValues: unknown[] = [];

  // Save and restore the real method because imported modules share this pool.
  // The replacement returns no claimed rows, stopping before object deletion.
  const queryOwner = pool as unknown as {
    query: (sql: string, values: unknown[]) => Promise<{ rows: unknown[] }>;
  };
  const originalQuery = queryOwner.query;

  queryOwner.query = async (sql, values) => {
    capturedSql = sql;
    capturedValues = values;
    return { rows: [] };
  };

  try {
    const result = await cleanupExpiredStorageBatch(25, 15);

    assert.deepEqual(result, { claimed: 0, deleted: 0, failed: 0 });
    assert.match(capturedSql, /FOR UPDATE SKIP LOCKED/);
    assert.match(capturedSql, /LIMIT \$1/);
    assert.deepEqual(capturedValues, [25, 15]);
  } finally {
    queryOwner.query = originalQuery;
    await pool.end();
  }
});


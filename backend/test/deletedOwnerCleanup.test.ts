/* Verify deleted-owner job rows disappear only after object deletion succeeds. */
import assert from "node:assert/strict";
import { after, test } from "node:test";

process.env.S3_ENDPOINT = "http://127.0.0.1:9000";
process.env.S3_REGION = "us-east-1";
process.env.S3_ACCESS_KEY_ID = "test-access-key";
process.env.S3_SECRET_ACCESS_KEY = "test-secret-key";
process.env.S3_BUCKET = "test-bucket";

const { pool } = await import("../src/db.js");
const { s3Client } = await import("../src/storage/s3.js");
const { cleanupExpiredStorageBatch } = await import(
  "../src/services/storageCleanup.js"
);

const queryOwner = pool as unknown as {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
};
const connectOwner = pool as unknown as {
  connect: () => Promise<{
    query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
    release: () => void;
  }>;
};
const sendOwner = s3Client as unknown as {
  send: (command: unknown) => Promise<Record<string, unknown>>;
};
const originalQuery = queryOwner.query;
const originalConnect = connectOwner.connect;
const originalSend = sendOwner.send;

after(async () => {
  queryOwner.query = originalQuery;
  connectOwner.connect = originalConnect;
  sendOwner.send = originalSend;
  await pool.end();
});

test("cleanup removes a deleted owner's job row in a second SQL statement", async () => {
  const transactionStatements: string[] = [];

  queryOwner.query = async () => ({
    rows: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        input_object_key: "uploads/test/missing.mp3",
        result_object_keys: null,
        cleanup_claim_id: "22222222-2222-4222-8222-222222222222",
      },
    ],
  });

  connectOwner.connect = async () => ({
    async query(sql) {
      transactionStatements.push(sql);

      if (sql.includes("RETURNING owner_deleted_at")) {
        return { rows: [{ owner_deleted_at: new Date() }] };
      }

      return { rows: [] };
    },
    release() {},
  });

  sendOwner.send = async (command) => {
    // The command classes expose a stable constructor name suitable for this
    // focused fake. Listing returns no partial stems; deletion reports no errors.
    const commandName = (command as object).constructor.name;
    return commandName === "ListObjectsV2Command" ? { Contents: [] } : {};
  };

  const result = await cleanupExpiredStorageBatch(1, 15);
  const combinedSql = transactionStatements.join("\n");

  assert.deepEqual(result, { claimed: 1, deleted: 1, failed: 0 });
  assert.match(combinedSql, /RETURNING owner_deleted_at/);
  assert.match(combinedSql, /DELETE FROM jobs/);
  assert.ok(transactionStatements.indexOf("BEGIN") < transactionStatements.indexOf("COMMIT"));
});

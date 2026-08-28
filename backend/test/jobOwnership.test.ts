/* Verify that job reads place session ownership directly in PostgreSQL queries. */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "../src/db.js";
import {
  findOwnedJob,
  findRecentOwnedJobs,
  jobHistoryLimit,
} from "../src/services/jobService.js";

type QueryReplacement = (
  sql: string,
  values: unknown[],
) => Promise<{ rows: never[] }>;

const queryOwner = pool as unknown as { query: QueryReplacement };
const originalQuery = queryOwner.query;

after(async () => {
  // Restore shared module state and close pg's unused timers after this test file.
  queryOwner.query = originalQuery;
  await pool.end();
});

test("single-job lookup filters by both job ID and owner ID", async () => {
  let capturedSql = "";
  let capturedValues: unknown[] = [];

  queryOwner.query = async (sql, values) => {
    capturedSql = sql;
    capturedValues = values;
    return { rows: [] };
  };

  const jobId = "11111111-1111-4111-8111-111111111111";
  const ownerId = "22222222-2222-4222-8222-222222222222";
  const job = await findOwnedJob(jobId, ownerId);

  assert.equal(job, null);
  assert.match(capturedSql, /WHERE id = \$1 AND owner_id = \$2/);
  assert.deepEqual(capturedValues, [jobId, ownerId]);
});

test("history filters by owner, orders newest first, and stays bounded", async () => {
  let capturedSql = "";
  let capturedValues: unknown[] = [];

  queryOwner.query = async (sql, values) => {
    capturedSql = sql;
    capturedValues = values;
    return { rows: [] };
  };

  const ownerId = "33333333-3333-4333-8333-333333333333";
  const jobs = await findRecentOwnedJobs(ownerId);

  assert.deepEqual(jobs, []);
  assert.match(capturedSql, /WHERE owner_id = \$1/);
  assert.match(capturedSql, /ORDER BY created_at DESC/);
  assert.match(capturedSql, /LIMIT \$2/);
  assert.deepEqual(capturedValues, [ownerId, jobHistoryLimit]);
  assert.equal(jobHistoryLimit, 20);
});


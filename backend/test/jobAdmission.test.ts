/* Verify race-safe duplicate and active-job checks during job creation. */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "../src/db.js";
import {
  ActiveJobLimitError,
  createJob,
  DuplicateUploadJobError,
  type JobRecord,
} from "../src/services/jobService.js";

type QueryResult = {
  rows: unknown[];
};

type FakeClient = {
  query: (sql: string, values?: unknown[]) => Promise<QueryResult>;
  release: () => void;
};

// pool.connect normally returns pg's large PoolClient type. These tests replace
// only the two methods createJob uses, so this narrow test type is easier to read.
const connectOwner = pool as unknown as {
  connect: () => Promise<FakeClient>;
};
const originalConnect = connectOwner.connect;

after(async () => {
  // Restore the real method for other modules and close pg's background timers.
  connectOwner.connect = originalConnect;
  await pool.end();
});

function createJobRecord(overrides: Partial<JobRecord> = {}): JobRecord {
  // Supply one complete row so tests can override only the field relevant to a
  // scenario. Dates are ordinary JavaScript values returned by the pg driver.
  return {
    id: "11111111-1111-4111-8111-111111111111",
    original_file_name: "song.mp3",
    input_object_key: "uploads/owner/upload-song.mp3",
    status: "PENDING",
    progress: 0,
    result_object_keys: null,
    error_message: null,
    storage_expires_at: null,
    storage_deleted_at: null,
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

test("creation locks one owner before checking and inserting work", async () => {
  const statements: string[] = [];
  let connectionReleased = false;
  const createdJob = createJobRecord();

  connectOwner.connect = async () => ({
    async query(sql) {
      statements.push(sql);

      if (sql.includes("input_object_key = $2")) {
        return { rows: [] };
      }

      if (sql.includes("active_job_count")) {
        return { rows: [{ active_job_count: 1 }] };
      }

      if (sql.includes("INSERT INTO jobs")) {
        return { rows: [createdJob] };
      }

      return { rows: [] };
    },
    release() {
      connectionReleased = true;
    },
  });

  const result = await createJob(
    "22222222-2222-4222-8222-222222222222",
    "song.mp3",
    "uploads/owner/upload-song.mp3",
  );
  const combinedSql = statements.join("\n");

  assert.equal(result, createdJob);
  assert.match(combinedSql, /pg_advisory_xact_lock/);
  assert.match(combinedSql, /input_object_key = \$2/);
  assert.match(combinedSql, /active_job_count/);
  assert.match(combinedSql, /INSERT INTO jobs/);
  assert.match(combinedSql, /INSERT INTO outbox_events/);
  assert.ok(statements.indexOf("BEGIN") < statements.indexOf("COMMIT"));
  assert.equal(connectionReleased, true);
});

test("an existing upload cannot create a second job or outbox event", async () => {
  const statements: string[] = [];
  let connectionReleased = false;
  const existingJob = createJobRecord({ status: "COMPLETED" });

  connectOwner.connect = async () => ({
    async query(sql) {
      statements.push(sql);

      if (sql.includes("input_object_key = $2")) {
        return { rows: [existingJob] };
      }

      return { rows: [] };
    },
    release() {
      connectionReleased = true;
    },
  });

  await assert.rejects(
    createJob(
      "22222222-2222-4222-8222-222222222222",
      "song.mp3",
      existingJob.input_object_key,
    ),
    (error: unknown) =>
      error instanceof DuplicateUploadJobError &&
      error.existingJob === existingJob,
  );

  assert.equal(statements.some((sql) => sql.includes("INSERT INTO jobs")), false);
  assert.equal(
    statements.some((sql) => sql.includes("INSERT INTO outbox_events")),
    false,
  );
  assert.equal(statements.includes("ROLLBACK"), true);
  assert.equal(connectionReleased, true);
});

test("an owner at capacity cannot add another active job", async () => {
  const statements: string[] = [];
  let connectionReleased = false;

  connectOwner.connect = async () => ({
    async query(sql) {
      statements.push(sql);

      if (sql.includes("input_object_key = $2")) {
        return { rows: [] };
      }

      if (sql.includes("active_job_count")) {
        return { rows: [{ active_job_count: 2 }] };
      }

      return { rows: [] };
    },
    release() {
      connectionReleased = true;
    },
  });

  await assert.rejects(
    createJob(
      "22222222-2222-4222-8222-222222222222",
      "another-song.mp3",
      "uploads/owner/another-song.mp3",
    ),
    (error: unknown) =>
      error instanceof ActiveJobLimitError && error.limit === 2,
  );

  assert.equal(statements.some((sql) => sql.includes("INSERT INTO jobs")), false);
  assert.equal(statements.includes("ROLLBACK"), true);
  assert.equal(connectionReleased, true);
});

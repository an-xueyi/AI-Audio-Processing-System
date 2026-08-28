/* Verify job-status rules without rendering React or contacting the backend. */
import assert from "node:assert/strict";
import test from "node:test";
import type { Job, JobStatus } from "../src/types";
import { haveJobResultsExpired, isActiveJob } from "../src/utils/jobs";

function createJob(overrides: Partial<Job> = {}): Job {
  // A complete default object keeps each test focused on only the fields that
  // matter to that particular rule.
  return {
    id: "11111111-1111-4111-8111-111111111111",
    original_file_name: "test-song.mp3",
    input_object_key: "uploads/session/test-song.mp3",
    status: "COMPLETED",
    progress: 100,
    result_object_keys: { vocals: "results/job/vocals.wav" },
    error_message: null,
    storage_expires_at: "2999-01-01T00:00:00.000Z",
    storage_deleted_at: null,
    created_at: "2026-08-27T10:00:00.000Z",
    updated_at: "2026-08-27T11:00:00.000Z",
    ...overrides,
  };
}

for (const status of ["PENDING", "PROCESSING", "RETRYING"] as JobStatus[]) {
  test(`${status} is treated as an active job`, () => {
    assert.equal(isActiveJob(createJob({ status })), true);
  });
}

for (const status of ["COMPLETED", "FAILED", "CANCELLED"] as JobStatus[]) {
  test(`${status} is treated as a terminal job`, () => {
    assert.equal(isActiveJob(createJob({ status })), false);
  });
}

test("completed results remain available before their deadline", () => {
  assert.equal(haveJobResultsExpired(createJob()), false);
});

test("a past deadline marks completed results as expired", () => {
  const job = createJob({
    storage_expires_at: "2000-01-01T00:00:00.000Z",
  });

  assert.equal(haveJobResultsExpired(job), true);
});

test("a deletion timestamp marks completed results as expired", () => {
  const job = createJob({
    storage_expires_at: "2999-01-01T00:00:00.000Z",
    storage_deleted_at: "2026-08-27T12:00:00.000Z",
  });

  assert.equal(haveJobResultsExpired(job), true);
});

test("failed jobs retain FAILED instead of becoming result-expired", () => {
  const job = createJob({
    status: "FAILED",
    storage_expires_at: "2000-01-01T00:00:00.000Z",
    storage_deleted_at: "2026-08-27T12:00:00.000Z",
  });

  assert.equal(haveJobResultsExpired(job), false);
});


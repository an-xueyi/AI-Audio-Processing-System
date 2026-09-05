/* Verify conversion of PostgreSQL worker aggregate text into API numbers. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  describeWorkerAvailability,
  parseWorkerCounts,
} from "../src/services/operationsService.js";

test("worker aggregate counts become ordinary JavaScript numbers", () => {
  const counts = parseWorkerCounts({
    active_workers: "3",
    idle_workers: "1",
    busy_workers: "2",
    recently_stale_workers: "0",
  });

  assert.deepEqual(counts, {
    active: 3,
    idle: 1,
    busy: 2,
    recentlyStale: 0,
  });
});

test("no recent heartbeat is described as offline", () => {
  assert.deepEqual(
    describeWorkerAvailability({
      active_workers: "0",
      idle_workers: "0",
      busy_workers: "0",
      recently_stale_workers: "1",
    }),
    {
      status: "offline",
      onlineWorkers: 0,
      idleWorkers: 0,
      busyWorkers: 0,
    },
  );
});

test("an idle worker makes processing immediately available", () => {
  assert.equal(
    describeWorkerAvailability({
      active_workers: "2",
      idle_workers: "1",
      busy_workers: "1",
      recently_stale_workers: "0",
    }).status,
    "available",
  );
});

test("online workers with no idle capacity are described as busy", () => {
  assert.equal(
    describeWorkerAvailability({
      active_workers: "1",
      idle_workers: "0",
      busy_workers: "1",
      recently_stale_workers: "0",
    }).status,
    "busy",
  );
});

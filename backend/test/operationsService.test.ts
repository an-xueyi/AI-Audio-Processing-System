/* Verify conversion of PostgreSQL worker aggregate text into API numbers. */
import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkerCounts } from "../src/services/operationsService.js";

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

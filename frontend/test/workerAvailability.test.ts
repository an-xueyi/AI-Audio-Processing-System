/* Verify the wording shown when local hybrid-worker capacity changes. */
import assert from "node:assert/strict";
import test from "node:test";
import { describeWorkerAvailability } from "../src/utils/workerAvailability";

test("offline workers explain that new jobs remain queued", () => {
  const display = describeWorkerAvailability({
    status: "offline",
    onlineWorkers: 0,
    idleWorkers: 0,
    busyWorkers: 0,
  });

  assert.equal(display.label, "Offline");
  assert.match(display.message, /wait safely in the queue/);
});

test("an idle worker is shown as available", () => {
  const display = describeWorkerAvailability({
    status: "available",
    onlineWorkers: 1,
    idleWorkers: 1,
    busyWorkers: 0,
  });

  assert.equal(display.label, "Available");
  assert.equal(display.message, "1 processing worker is ready.");
});

test("busy workers remain distinct from offline workers", () => {
  const display = describeWorkerAvailability({
    status: "busy",
    onlineWorkers: 1,
    idleWorkers: 0,
    busyWorkers: 1,
  });

  assert.equal(display.label, "Busy");
  assert.match(display.message, /wait in the queue/);
});

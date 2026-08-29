/* Verify request correlation and the small in-process operational counters. */
import assert from "node:assert/strict";
import test from "node:test";
import { writeLog } from "../src/observability/logger.js";
import {
  getHttpMetricsSnapshot,
  recordHttpResponse,
  recordWebSocketClosed,
  recordWebSocketOpened,
  resetHttpMetricsForTests,
} from "../src/observability/metrics.js";
import { runWithRequestContext } from "../src/observability/requestContext.js";

test("a structured log inherits the current asynchronous request ID", async () => {
  let writtenText = "";
  const originalWrite = process.stdout.write;

  /*
   * Replace stdout only during this test. writeLog normally writes to the
   * terminal, but capturing the text lets the test parse and inspect it without
   * filling the test report with an extra log line.
   */
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writtenText += chunk.toString();
    return true;
  }) as typeof process.stdout.write;

  try {
    await runWithRequestContext(
      { requestId: "request-test-123" },
      async () => {
        // Promise.resolve creates an asynchronous boundary. AsyncLocalStorage
        // should preserve the same request context on the other side of it.
        await Promise.resolve();
        writeLog("info", "test_event", { jobId: "job-test-456" });
      },
    );
  } finally {
    // Always restore stdout, even if an assertion or logger call throws.
    process.stdout.write = originalWrite;
  }

  const record = JSON.parse(writtenText) as Record<string, unknown>;

  assert.equal(record.level, "info");
  assert.equal(record.event, "test_event");
  assert.equal(record.requestId, "request-test-123");
  assert.equal(record.jobId, "job-test-456");
  assert.equal(typeof record.timestamp, "string");
});

test("HTTP and WebSocket metrics record useful process-level totals", () => {
  // Reset shared module state so this test has a predictable starting point.
  resetHttpMetricsForTests();

  recordHttpResponse(201);
  recordHttpResponse(302);
  recordHttpResponse(404);
  recordHttpResponse(503);
  recordWebSocketOpened();
  recordWebSocketOpened();
  recordWebSocketClosed();

  assert.deepEqual(getHttpMetricsSnapshot(), {
    requestsTotal: 4,
    responses: {
      "2xx": 1,
      "3xx": 1,
      "4xx": 1,
      "5xx": 1,
    },
    activeWebSocketConnections: 1,
  });
});

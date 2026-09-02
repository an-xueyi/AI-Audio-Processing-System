/*
 * Timing and status rules shared by the job-subscription connection.
 *
 * These values form one policy: how quickly the browser decides that a
 * connection is stuck, how often HTTP fallback requests run, how WebSocket
 * reconnection slows down, and which job statuses require no more updates.
 */
import type { JobStatus } from "../types";

// Give the server ten seconds to open a WebSocket before treating the attempt as
// stuck. Numeric separators make 10_000 easier to read; its value is 10000 ms.
export const connectionTimeoutMs = 10_000;

// Poll the ordinary HTTP job endpoint every two seconds only as a backup.
export const fallbackPollingIntervalMs = 2_000;

// Each failed WebSocket attempt uses the next delay. Waiting longer over time
// avoids sending rapid connection attempts while the backend is unavailable.
export const reconnectDelaysMs = [1_000, 2_000, 4_000, 8_000, 10_000];

// A terminal status means processing will never move to another active status.
// ReadonlySet communicates that callers should only check this collection.
export const terminalStatuses: ReadonlySet<JobStatus> = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

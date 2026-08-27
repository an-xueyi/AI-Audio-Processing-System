/* Shared job-status rules used by history recovery and job selection. */
import type { Job, JobStatus } from "../types";

// These jobs may still change and therefore need a live WebSocket subscription.
const activeStatuses: ReadonlySet<JobStatus> = new Set([
  "PENDING",
  "PROCESSING",
  "RETRYING",
]);

export function isActiveJob(job: Job): boolean {
  // Set.has returns true only when this job's typed status is in the collection.
  return activeStatuses.has(job.status);
}

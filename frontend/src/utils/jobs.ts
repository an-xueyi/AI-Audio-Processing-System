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

export function haveJobResultsExpired(job: Job): boolean {
  // Only completed jobs ever offered downloadable results. Failed and cancelled
  // jobs keep their more useful failure/cancellation labels after storage cleanup.
  if (job.status !== "COMPLETED") {
    return false;
  }

  if (job.storage_deleted_at) {
    // Physical deletion is authoritative even if a malformed timestamp exists.
    // A truthy check also treats a temporarily older API response with no field
    // as unavailable metadata rather than incorrectly calling it expired.
    return true;
  }

  if (!job.storage_expires_at) {
    // Older or incomplete data without an expiration time is not guessed expired.
    return false;
  }

  // Date.parse converts the ISO timestamp to milliseconds for comparison with
  // the browser clock. The backend repeats this check authoritatively on download.
  return Date.parse(job.storage_expires_at) <= Date.now();
}

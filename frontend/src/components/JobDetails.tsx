/* Display current job state and offer cancellation only while it is meaningful. */
import type { Job, JobStatus } from "../types";
import { haveJobResultsExpired } from "../utils/jobs";

const cancellableStatuses: ReadonlySet<JobStatus> = new Set([
  "PENDING",
  "PROCESSING",
  "RETRYING",
]);

// Use the viewer's local date and time format for the retention deadline.
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

type JobDetailsProps = {
  // isCancelling controls button state while the network request is pending.
  isCancelling: boolean;
  // job is the latest complete snapshot received from HTTP or WebSocket.
  job: Job;
  // The parent owns cancellation logic; this component only reports the click.
  onCancel: () => void;
};

export function JobDetails({ isCancelling, job, onCancel }: JobDetailsProps) {
  // A Set makes the business rule readable: terminal jobs are absent and cannot
  // show the cancellation button.
  const canCancel = cancellableStatuses.has(job.status);
  const resultsHaveExpired = haveJobResultsExpired(job);
  const displayedStatus = resultsHaveExpired ? "EXPIRED" : job.status;

  return (
    <section className="panel">
      <div className="section-header">
        <h2>Created Job</h2>
        {/* EXPIRED describes result availability without changing the durable
            PostgreSQL processing status, which remains COMPLETED. */}
        <span
          className={
            resultsHaveExpired ? "status-pill expired" : "status-pill"
          }
        >
          {displayedStatus}
        </span>
      </div>

      <div className="job-grid">
        <p>
          <strong>Job ID:</strong> {job.id}
        </p>
        <p>
          <strong>Progress:</strong> {job.progress}%
        </p>
        {/* Native <progress> provides accessible percentage semantics. */}
        <progress className="job-progress" max="100" value={job.progress}>
          {job.progress}%
        </progress>
        <p>
          <strong>Input Object Key:</strong> {job.input_object_key}
        </p>
        {/* Completed jobs explain exactly how long their private files remain. */}
        {job.status === "COMPLETED" && resultsHaveExpired && (
          <p>
            <strong>Results:</strong> Expired and no longer available
          </p>
        )}
        {job.status === "COMPLETED" &&
          !resultsHaveExpired &&
          job.storage_expires_at && (
            <p>
              <strong>Results available until:</strong>{" "}
              <time dateTime={job.storage_expires_at}>
                {dateFormatter.format(new Date(job.storage_expires_at))}
              </time>
            </p>
          )}
        {/* Show worker error details only when the nullable field contains text. */}
        {job.error_message && (
          <p>
            <strong>Error:</strong> {job.error_message}
          </p>
        )}
      </div>

      {/* Terminal jobs omit the button entirely rather than merely disabling it. */}
      {canCancel && (
        <button
          className="secondary-button cancel-job-button"
          type="button"
          onClick={onCancel}
          disabled={isCancelling}
        >
          {isCancelling ? "Cancelling..." : "Cancel Processing"}
        </button>
      )}
    </section>
  );
}

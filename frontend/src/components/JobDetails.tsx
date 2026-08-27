/* Display current job state and offer cancellation only while it is meaningful. */
import type { Job, JobStatus } from "../types";

const cancellableStatuses: ReadonlySet<JobStatus> = new Set([
  "PENDING",
  "PROCESSING",
  "RETRYING",
]);

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

  return (
    <section className="panel">
      <div className="section-header">
        <h2>Created Job</h2>
        {/* Status text comes directly from the typed JobStatus value. */}
        <span className="status-pill">{job.status}</span>
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

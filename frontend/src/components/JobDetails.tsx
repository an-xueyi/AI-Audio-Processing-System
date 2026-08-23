import type { Job, JobStatus } from "../types";

const cancellableStatuses: ReadonlySet<JobStatus> = new Set([
  "PENDING",
  "PROCESSING",
  "RETRYING",
]);

type JobDetailsProps = {
  isCancelling: boolean;
  job: Job;
  onCancel: () => void;
};

export function JobDetails({ isCancelling, job, onCancel }: JobDetailsProps) {
  const canCancel = cancellableStatuses.has(job.status);

  return (
    <section className="panel">
      <div className="section-header">
        <h2>Created Job</h2>
        <span className="status-pill">{job.status}</span>
      </div>

      <div className="job-grid">
        <p>
          <strong>Job ID:</strong> {job.id}
        </p>
        <p>
          <strong>Progress:</strong> {job.progress}%
        </p>
        <progress className="job-progress" max="100" value={job.progress}>
          {job.progress}%
        </progress>
        <p>
          <strong>Input Object Key:</strong> {job.input_object_key}
        </p>
        {job.error_message && (
          <p>
            <strong>Error:</strong> {job.error_message}
          </p>
        )}
      </div>

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

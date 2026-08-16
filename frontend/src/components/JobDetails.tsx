import type { Job } from "../types";

type JobDetailsProps = {
  job: Job;
};

export function JobDetails({ job }: JobDetailsProps) {
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
        <p>
          <strong>Input Object Key:</strong> {job.input_object_key}
        </p>
        {job.error_message && (
          <p>
            <strong>Error:</strong> {job.error_message}
          </p>
        )}
      </div>
    </section>
  );
}

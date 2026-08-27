/* Render recent session-owned jobs and let the user reopen one job's details. */
import type { Job } from "../types";
import { haveJobResultsExpired } from "../utils/jobs";

// Intl uses the browser's locale and time zone, so history dates are readable to
// the current user without manually formatting year/month/day strings.
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

type JobHistoryProps = {
  // Loading and empty states are different: an empty loaded array is valid data.
  isLoading: boolean;
  jobs: Job[];
  // The selected ID controls visual highlighting; null means no open history job.
  selectedJobId: string | null;
  // The parent receives the complete Job snapshot when a history row is clicked.
  onJobSelected: (job: Job) => void;
};

export function JobHistory({
  isLoading,
  jobs,
  selectedJobId,
  onJobSelected,
}: JobHistoryProps) {
  return (
    <section className="panel">
      <div className="section-header">
        <h2>Job History</h2>
        {/* Avoid showing "0 recent" while the request is still in progress. */}
        <span className="history-count">
          {isLoading ? "Loading" : `${jobs.length} recent`}
        </span>
      </div>

      {/* Show one clear state at a time: loading, empty, or the interactive list. */}
      {isLoading ? (
        <p className="message">Loading job history...</p>
      ) : jobs.length === 0 ? (
        <p className="message">No processing jobs yet.</p>
      ) : (
        <ul className="job-history-list">
          {jobs.map((historyJob) => {
            // Comparing UUIDs is enough to identify the row currently shown below.
            const isSelected = historyJob.id === selectedJobId;
            const resultsHaveExpired = haveJobResultsExpired(historyJob);
            const displayedStatus = resultsHaveExpired
              ? "EXPIRED"
              : historyJob.status;

            return (
              <li key={historyJob.id}>
                <button
                  className={
                    isSelected
                      ? "job-history-item selected"
                      : "job-history-item"
                  }
                  type="button"
                  // aria-current communicates the selected record to assistive tools.
                  aria-current={isSelected ? "true" : undefined}
                  onClick={() => onJobSelected(historyJob)}
                >
                  <span className="job-history-main">
                    <strong>{historyJob.original_file_name}</strong>
                    {/* dateTime keeps the original machine-readable ISO timestamp. */}
                    <time dateTime={historyJob.created_at}>
                      {dateFormatter.format(new Date(historyJob.created_at))}
                    </time>
                  </span>

                  <span className="job-history-progress">
                    <span
                      className={
                        resultsHaveExpired
                          ? "status-pill expired"
                          : "status-pill"
                      }
                    >
                      {displayedStatus}
                    </span>
                    <span>{historyJob.progress}%</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* Store recent jobs and keep their WebSocket-updated snapshots current. */
import { useCallback, useState } from "react";
import { fetchJobHistory } from "../api/audioProcessing";
import type { Job } from "../types";

export function useJobHistory() {
  // The backend returns newest first. Keeping that order means the first active
  // item is also the newest active job during refresh recovery.
  const [jobHistory, setJobHistory] = useState<Job[]>([]);

  // This Boolean lets the component distinguish "still loading" from a valid
  // empty array belonging to a session that has never created a job.
  const [isJobHistoryLoading, setIsJobHistoryLoading] = useState(false);

  const loadJobHistory = useCallback(async (): Promise<Job[]> => {
    // Enable loading before starting the network request so the interface can
    // immediately show that recovery work is happening.
    setIsJobHistoryLoading(true);

    try {
      const jobs = await fetchJobHistory();

      // Replace the complete list with PostgreSQL's newest-to-oldest result.
      setJobHistory(jobs);
      return jobs;
    } finally {
      // finally runs after success and failure, preventing a permanent loading UI.
      setIsJobHistoryLoading(false);
    }
  }, []);

  const upsertHistoryJob = useCallback((updatedJob: Job) => {
    /*
     * A created job may not exist in the loaded history yet, while a WebSocket
     * update usually replaces an existing job. The functional setter receives
     * the latest array even when several updates arrive close together.
     */
    setJobHistory((currentJobs) => {
      const existingIndex = currentJobs.findIndex(
        (historyJob) => historyJob.id === updatedJob.id,
      );

      if (existingIndex === -1) {
        // New jobs belong at the front because they have the newest created_at.
        return [updatedJob, ...currentJobs];
      }

      // map preserves the existing newest-to-oldest order while replacing only
      // the matching immutable object with its latest complete snapshot.
      return currentJobs.map((historyJob) =>
        historyJob.id === updatedJob.id ? updatedJob : historyJob,
      );
    });
  }, []);

  return {
    isJobHistoryLoading,
    jobHistory,
    loadJobHistory,
    upsertHistoryJob,
  };
}

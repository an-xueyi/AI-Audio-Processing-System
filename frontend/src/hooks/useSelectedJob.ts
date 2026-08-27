/*
 * Own the currently displayed job, its download URLs, and its realtime socket.
 * Keeping this lifecycle separate prevents upload/session code from also having
 * to manage stale asynchronous results and WebSocket selection changes.
 */
import { useCallback, useRef, useState } from "react";
import { fetchDownloadUrls } from "../api/audioProcessing";
import type { Job } from "../types";
import { haveJobResultsExpired, isActiveJob } from "../utils/jobs";
import { useJobWebSocket } from "./useJobWebSocket";

type SelectedJobOptions = {
  onStatusMessage: (message: string) => void;
  upsertHistoryJob: (job: Job) => void;
};

export function useSelectedJob({
  onStatusMessage,
  upsertHistoryJob,
}: SelectedJobOptions) {
  // null means no job is currently open in the detail panel.
  const [job, setJob] = useState<Job | null>(null);

  // URLs are separate from Job because they expire and are generated on demand.
  const [downloadUrls, setDownloadUrls] = useState<Record<
    string,
    string
  > | null>(null);

  // A ref updates synchronously without waiting for a React render. Async download
  // requests compare against it before writing results to the current screen.
  const selectedJobIdRef = useRef<string | null>(null);

  const handleJobUpdate = useCallback(
    async (updatedJob: Job) => {
      // History receives all valid updates, including one arriving while an old
      // WebSocket is closing after the user changed selections.
      upsertHistoryJob(updatedJob);

      // A stale job may update history but must not replace current detail state.
      if (selectedJobIdRef.current !== updatedJob.id) {
        return;
      }

      setJob(updatedJob);

      if (updatedJob.status === "COMPLETED") {
        if (haveJobResultsExpired(updatedJob)) {
          // Do not request a URL that the backend is required to reject. Keeping
          // downloadUrls null also removes any links belonging to an older job.
          setDownloadUrls(null);
          onStatusMessage(
            "These audio results have expired and are no longer available.",
          );
          return;
        }

        try {
          // Always request fresh links because any links from an earlier visit may
          // have passed their five-minute expiration time.
          const urls = await fetchDownloadUrls(updatedJob.id);

          if (selectedJobIdRef.current !== updatedJob.id) {
            // The user selected another row while fetchDownloadUrls was pending.
            return;
          }

          setDownloadUrls(urls);
          onStatusMessage("Job completed! Download links are ready.");
        } catch (error) {
          // Apply the same stale-selection guard to error messages. Otherwise an
          // old failed request could replace a newer job's useful progress text.
          if (selectedJobIdRef.current !== updatedJob.id) {
            return;
          }

          onStatusMessage(
            error instanceof Error
              ? error.message
              : "Job completed, but download links could not be loaded.",
          );
        }
        return;
      }

      if (updatedJob.status === "FAILED") {
        onStatusMessage(
          updatedJob.error_message
            ? `Job failed: ${updatedJob.error_message}`
            : "Job failed.",
        );
        return;
      }

      if (updatedJob.status === "CANCELLED") {
        onStatusMessage("Job processing was cancelled.");
        return;
      }

      onStatusMessage(
        `Job is ${updatedJob.status}. Progress: ${updatedJob.progress}%`,
      );
    },
    [onStatusMessage, upsertHistoryJob],
  );

  const { subscribeToJob, unsubscribeFromJob } = useJobWebSocket({
    onJobUpdate: handleJobUpdate,
    onStatusMessage,
  });

  const selectJob = useCallback(
    (selectedJob: Job) => {
      // Change the ref before starting or cancelling async work so older requests
      // immediately recognize that they no longer own the detail screen.
      selectedJobIdRef.current = selectedJob.id;
      unsubscribeFromJob();
      setDownloadUrls(null);

      // Reuse one status path for history clicks, recovered jobs, newly created
      // jobs, cancellation responses, and realtime WebSocket snapshots.
      void handleJobUpdate(selectedJob);

      if (isActiveJob(selectedJob)) {
        // Terminal jobs need fresh download links but no ongoing WebSocket.
        subscribeToJob(selectedJob.id);
      }
    },
    [handleJobUpdate, subscribeToJob, unsubscribeFromJob],
  );

  const clearSelectedJob = useCallback(() => {
    // This is used when a new local file is selected and the old detail panel
    // should disappear without deleting its durable history record.
    selectedJobIdRef.current = null;
    unsubscribeFromJob();
    setJob(null);
    setDownloadUrls(null);
  }, [unsubscribeFromJob]);

  return {
    clearSelectedJob,
    downloadUrls,
    job,
    selectJob,
  };
}

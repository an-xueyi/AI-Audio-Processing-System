/*
 * Coordinate the complete user workflow: initialize a session, select a file,
 * upload it directly, create a Kafka-backed job, receive live status, cancel
 * work, and request result links. Components consume this hook as one clear API.
 */
import { useEffect, useState } from "react";
import {
  cancelProcessingJob,
  createBrowserSession,
  createProcessingJob,
  fetchBackendHealth,
  requestPresignedUpload,
  uploadAudioFile,
} from "../api/audioProcessing";
import type { HealthResponse } from "../types";
import { getAudioContentType } from "../utils/audio";
import { isActiveJob } from "../utils/jobs";
import { useJobHistory } from "./useJobHistory";
import { useSelectedJob } from "./useSelectedJob";

export function useAudioProcessing() {
  // useState stores values between React renders. Each setter schedules another
  // render so the visible interface reflects the new application state.
  const [backendHealth, setBackendHealth] = useState<HealthResponse | null>(
    null,
  );
  // null means the user has not selected a browser File yet.
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // message is shared by status and upload sections as human-readable feedback.
  const [message, setMessage] = useState("Checking backend...");

  // Boolean flags disable commands while their asynchronous operation is active.
  const [isUploading, setIsUploading] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  // A file cannot be uploaded until the signed browser session has been created.
  const [sessionReady, setSessionReady] = useState(false);

  const {
    isJobHistoryLoading,
    jobHistory,
    loadJobHistory,
    upsertHistoryJob,
  } = useJobHistory();

  const { clearSelectedJob, downloadUrls, job, selectJob } = useSelectedJob({
    onStatusMessage: setMessage,
    upsertHistoryJob,
  });

  useEffect(() => {
    // An effect performs work outside rendering. In this case, the effect
    // creates the browser session, checks the backend, and restores job history
    // when this hook is first used. The dependency array at the bottom lists
    // the stable callback functions that the effect uses.
    let isActive = true;

    async function initializeApplication() {
      try {
        // Establish ownership first so all later protected API requests have a cookie.
        await createBrowserSession();

        // Then verify that the backend process is reachable.
        const health = await fetchBackendHealth();

        // The request may finish after the component is removed. isActive avoids
        // updating state for a screen that no longer exists.
        if (isActive) {
          setBackendHealth(health);
        }

        try {
          // History must be requested after createBrowserSession because the API
          // derives ownership from the newly established cookie.
          const recoveredJobs = await loadJobHistory();

          if (!isActive) {
            return;
          }

          // Enable uploading only after the initial history snapshot is applied,
          // preventing it from overwriting a job created during recovery.
          setSessionReady(true);

          // The list is newest first, so find returns the newest unfinished job.
          const recoveredActiveJob = recoveredJobs.find(isActiveJob);

          if (recoveredActiveJob) {
            // Restore detail state before subscribing. The server sends another
            // authoritative current snapshot immediately after subscription.
            selectJob(recoveredActiveJob);
            setMessage(
              `Recovered ${recoveredActiveJob.original_file_name} at ` +
                `${recoveredActiveJob.progress}%.`,
            );
          } else {
            setMessage("Backend is connected.");
          }
        } catch (error) {
          // Uploading remains usable when only history loading fails.
          if (isActive) {
            setSessionReady(true);
            setMessage(
              error instanceof Error
                ? error.message
                : "Backend connected, but job history could not be loaded.",
            );
          }
        }
      } catch {
        // Initialization failures intentionally share a simple user message. The
        // browser console/network panel can provide technical request details.
        if (isActive) {
          setSessionReady(false);
          setMessage("Could not connect to backend.");
        }
      }
    }

    // `void` explicitly discards the Promise because useEffect itself must not
    // return a Promise; it may return only a synchronous cleanup function.
    void initializeApplication();

    return () => {
      // React calls this cleanup during unmount and StrictMode's development check.
      isActive = false;
    };
  }, [loadJobHistory, selectJob]);

  function selectFile(file: File | null) {
    // Selecting another file resets every result belonging to the previous job
    // and closes its realtime subscription.
    clearSelectedJob();
    // Store the new File object or null if the browser input was cleared.
    setSelectedFile(file);
    // The ternary chooses a message based on whether a File currently exists.
    setMessage(
      file ? `Selected file: ${file.name}` : "Please choose an audio file",
    );
  }

  async function startProcessing() {
    // Guard clauses stop early and keep the main success path less deeply nested.
    if (!selectedFile) {
      setMessage("Please choose an audio file first.");
      return;
    }

    if (!sessionReady) {
      setMessage("The secure browser session is not ready.");
      return;
    }

    // Determine the MIME type needed in both presign and direct PUT requests.
    const contentType = getAudioContentType(selectedFile);

    // An empty type means neither browser metadata nor extension fallback worked.
    if (!contentType) {
      setMessage("Could not determine the selected file's audio type.");
      return;
    }

    try {
      setIsUploading(true);
      // Step 1: ask the backend for temporary, narrowly scoped upload permission.
      setMessage("Requesting presigned URL...");
      const presignData = await requestPresignedUpload(
        selectedFile,
        contentType,
      );

      // Step 2: send the large audio bytes directly to object storage.
      setMessage("Uploading file to object storage...");
      await uploadAudioFile(presignData.uploadUrl, selectedFile, contentType);

      // Step 3: create a small database job that references the stored object.
      setMessage("Creating processing job...");
      const createdJob = await createProcessingJob(
        selectedFile.name,
        presignData.objectKey,
      );

      // Make the new job current and add it to the beginning of visible history.
      // Step 4: show the job, add history, and watch WebSocket updates.
      selectJob(createdJob);
      setMessage("Job created. The worker will process it in the background.");
    } catch (error) {
      // All three network stages report through one user-visible error path.
      setMessage(
        error instanceof Error ? error.message : "Something went wrong.",
      );
    } finally {
      // finally runs after success or failure, ensuring the button is re-enabled.
      setIsUploading(false);
    }
  }

  async function cancelJob() {
    // Ignore cancellation when no job exists or a previous click is still pending.
    if (!job || isCancelling) {
      return;
    }

    try {
      setIsCancelling(true);
      setMessage("Cancelling job processing...");
      const cancelledJob = await cancelProcessingJob(job.id);
      // Use the database response as authoritative detail and history state.
      selectJob(cancelledJob);
      setMessage("Job processing was cancelled.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to cancel job.",
      );
    } finally {
      // Re-enable the button even if the cancellation request failed.
      setIsCancelling(false);
    }
  }

  // Expose state for rendering and named actions for user events. Internal setter
  // functions and workflow details remain private to this hook.
  return {
    backendHealth,
    cancelJob,
    downloadUrls,
    isUploading,
    isCancelling,
    isJobHistoryLoading,
    job,
    jobHistory,
    message,
    selectedFile,
    sessionReady,
    selectFile,
    selectHistoryJob: selectJob,
    startProcessing,
  };
}

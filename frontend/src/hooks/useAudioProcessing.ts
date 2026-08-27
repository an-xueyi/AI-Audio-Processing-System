/*
 * Coordinate the complete user workflow: initialize a session, select a file,
 * upload it directly, create a Kafka-backed job, receive live status, cancel
 * work, and request result links. Components consume this hook as one clear API.
 */
import { useCallback, useEffect, useState } from "react";
import {
  cancelProcessingJob,
  createBrowserSession,
  createProcessingJob,
  fetchBackendHealth,
  fetchDownloadUrls,
  requestPresignedUpload,
  uploadAudioFile,
} from "../api/audioProcessing";
import type { HealthResponse, Job } from "../types";
import { getAudioContentType } from "../utils/audio";
import { useJobWebSocket } from "./useJobWebSocket";

export function useAudioProcessing() {
  // useState stores values between React renders. Each setter schedules another
  // render so the visible interface reflects the new application state.
  const [backendHealth, setBackendHealth] = useState<HealthResponse | null>(
    null,
  );
  // null means the user has not selected a browser File yet.
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // job remains null until the backend successfully creates a database record.
  const [job, setJob] = useState<Job | null>(null);

  // message is shared by status and upload sections as human-readable feedback.
  const [message, setMessage] = useState("Checking backend...");

  // Boolean flags disable commands while their asynchronous operation is active.
  const [isUploading, setIsUploading] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  // A file cannot be uploaded until the signed browser session has been created.
  const [sessionReady, setSessionReady] = useState(false);

  // The key is a stem name and the value is its temporary signed download URL.
  const [downloadUrls, setDownloadUrls] = useState<Record<
    string,
    string
  > | null>(null);

  // useCallback keeps the same function identity across renders. That prevents
  // the WebSocket hook from reconnecting merely because the component rendered.
  const handleJobUpdate = useCallback(async (updatedJob: Job) => {
    // Replace the previous job snapshot so status, progress, and errors rerender.
    setJob(updatedJob);

    // A completed job requires one additional API call for temporary result URLs.
    if (updatedJob.status === "COMPLETED") {
      try {
        const urls = await fetchDownloadUrls(updatedJob.id);
        // Saving URLs causes DownloadResults to appear in App.
        setDownloadUrls(urls);
        setMessage("Job completed! Download links are ready.");
      } catch (error) {
        // Separation succeeded even if this temporary URL request failed, so the
        // message makes that distinction instead of calling the job failed.
        setMessage(
          error instanceof Error
            ? error.message
            : "Job completed, but download links could not be loaded.",
        );
      }
      // Terminal handling is complete; do not replace this message below.
      return;
    }

    // A failed job may contain the detailed worker error stored in PostgreSQL.
    if (updatedJob.status === "FAILED") {
      setMessage(
        updatedJob.error_message
          ? `Job failed: ${updatedJob.error_message}`
          : "Job failed.",
      );
      return;
    }

    // Cancellation is expected user action and receives its own message.
    if (updatedJob.status === "CANCELLED") {
      setMessage("Job processing was cancelled.");
      return;
    }

    // Any remaining status is active: PENDING, PROCESSING, or RETRYING.
    setMessage(
      `Job is ${updatedJob.status}. Progress: ${updatedJob.progress}%`,
    );
  }, []);

  const { subscribeToJob, unsubscribeFromJob } = useJobWebSocket({
    // Pass the stable update callback and React's message setter into the
    // WebSocket hook's simpler interface.
    onJobUpdate: handleJobUpdate,
    onStatusMessage: setMessage,
  });

  useEffect(() => {
    // An effect performs work outside rendering. The empty dependency array at
    // the bottom means initialization runs when this hook is first mounted.
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
          // Enabling sessionReady allows UploadPanel's button to become active.
          setSessionReady(true);
          setMessage("Backend is connected.");
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
  }, []);

  function selectFile(file: File | null) {
    // Selecting another file resets every result belonging to the previous job
    // and closes its realtime subscription.
    unsubscribeFromJob();
    // Store the new File object or null if the browser input was cleared.
    setSelectedFile(file);
    setJob(null);
    setDownloadUrls(null);
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

      setJob(createdJob);
      // Step 4: watch Kafka-driven backend updates over a WebSocket.
      subscribeToJob(createdJob.id);
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
      // Use the database response as the authoritative final state.
      setJob(cancelledJob);

      // A cancelled job must not show result links from an earlier state.
      setDownloadUrls(null);
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
    job,
    message,
    selectedFile,
    sessionReady,
    selectFile,
    startProcessing,
  };
}

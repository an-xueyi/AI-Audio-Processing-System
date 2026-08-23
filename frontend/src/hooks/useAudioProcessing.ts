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
  const [backendHealth, setBackendHealth] = useState<HealthResponse | null>(
    null,
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [message, setMessage] = useState("Checking backend...");
  const [isUploading, setIsUploading] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [downloadUrls, setDownloadUrls] = useState<Record<
    string,
    string
  > | null>(null);

  const handleJobUpdate = useCallback(async (updatedJob: Job) => {
    setJob(updatedJob);

    if (updatedJob.status === "COMPLETED") {
      try {
        const urls = await fetchDownloadUrls(updatedJob.id);
        setDownloadUrls(urls);
        setMessage("Job completed! Download links are ready.");
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Job completed, but download links could not be loaded.",
        );
      }
      return;
    }

    if (updatedJob.status === "FAILED") {
      setMessage(
        updatedJob.error_message
          ? `Job failed: ${updatedJob.error_message}`
          : "Job failed.",
      );
      return;
    }

    if (updatedJob.status === "CANCELLED") {
      setMessage("Job processing was cancelled.");
      return;
    }

    setMessage(
      `Job is ${updatedJob.status}. Progress: ${updatedJob.progress}%`,
    );
  }, []);

  const { subscribeToJob, unsubscribeFromJob } = useJobWebSocket({
    onJobUpdate: handleJobUpdate,
    onStatusMessage: setMessage,
  });

  useEffect(() => {
    let isActive = true;

    async function initializeApplication() {
      try {
        await createBrowserSession();
        const health = await fetchBackendHealth();

        if (isActive) {
          setBackendHealth(health);
          setSessionReady(true);
          setMessage("Backend is connected.");
        }
      } catch {
        if (isActive) {
          setSessionReady(false);
          setMessage("Could not connect to backend.");
        }
      }
    }

    void initializeApplication();

    return () => {
      isActive = false;
    };
  }, []);

  function selectFile(file: File | null) {
    unsubscribeFromJob();
    setSelectedFile(file);
    setJob(null);
    setDownloadUrls(null);
    setMessage(
      file ? `Selected file: ${file.name}` : "Please choose an audio file",
    );
  }

  async function startProcessing() {
    if (!selectedFile) {
      setMessage("Please choose an audio file first.");
      return;
    }

    if (!sessionReady) {
      setMessage("The secure browser session is not ready.");
      return;
    }

    const contentType = getAudioContentType(selectedFile);

    if (!contentType) {
      setMessage("Could not determine the selected file's audio type.");
      return;
    }

    try {
      setIsUploading(true);
      setMessage("Requesting presigned URL...");
      const presignData = await requestPresignedUpload(
        selectedFile,
        contentType,
      );

      setMessage("Uploading file to object storage...");
      await uploadAudioFile(presignData.uploadUrl, selectedFile, contentType);

      setMessage("Creating processing job...");
      const createdJob = await createProcessingJob(
        selectedFile.name,
        presignData.objectKey,
      );

      setJob(createdJob);
      subscribeToJob(createdJob.id);
      setMessage("Job created. The worker will process it in the background.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Something went wrong.",
      );
    } finally {
      setIsUploading(false);
    }
  }

  async function cancelJob() {
    if (!job || isCancelling) {
      return;
    }

    try {
      setIsCancelling(true);
      setMessage("Cancelling job processing...");
      const cancelledJob = await cancelProcessingJob(job.id);
      setJob(cancelledJob);
      setDownloadUrls(null);
      setMessage("Job processing was cancelled.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to cancel job.",
      );
    } finally {
      setIsCancelling(false);
    }
  }

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

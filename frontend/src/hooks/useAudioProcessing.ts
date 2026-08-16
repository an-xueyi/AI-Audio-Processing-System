import { useEffect, useRef, useState } from "react";
import {
  createBrowserSession,
  createProcessingJob,
  fetchBackendHealth,
  fetchDownloadUrls,
  requestPresignedUpload,
  uploadAudioFile,
} from "../api/audioProcessing";
import { WS_BASE_URL } from "../config";
import type { HealthResponse, Job, JobWebSocketMessage } from "../types";
import { getAudioContentType } from "../utils/audio";

export function useAudioProcessing() {
  const [backendHealth, setBackendHealth] = useState<HealthResponse | null>(
    null,
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [message, setMessage] = useState("Checking backend...");
  const [isUploading, setIsUploading] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [downloadUrls, setDownloadUrls] = useState<Record<
    string,
    string
  > | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

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
      socketRef.current?.close();
    };
  }, []);

  function connectJobWebSocket(jobId: string) {
    socketRef.current?.close();

    const socket = new WebSocket(`${WS_BASE_URL}/ws/jobs?jobId=${jobId}`);
    socketRef.current = socket;
    let shouldShowClosedMessage = true;

    socket.onopen = () => {
      setMessage("Connected to job status updates.");
    };

    socket.onmessage = async (event) => {
      try {
        const webSocketMessage = JSON.parse(
          event.data,
        ) as JobWebSocketMessage;

        if (webSocketMessage.type === "error") {
          setMessage(webSocketMessage.error);
          shouldShowClosedMessage = false;
          socket.close();
          return;
        }

        const updatedJob = webSocketMessage.job;
        setJob(updatedJob);

        if (updatedJob.status === "COMPLETED") {
          const urls = await fetchDownloadUrls(updatedJob.id);
          setDownloadUrls(urls);
          setMessage("Job completed! Download links are ready.");
          shouldShowClosedMessage = false;
          socket.close();
          return;
        }

        if (updatedJob.status === "FAILED") {
          setMessage(
            updatedJob.error_message
              ? `Job failed: ${updatedJob.error_message}`
              : "Job failed.",
          );
          shouldShowClosedMessage = false;
          socket.close();
          return;
        }

        setMessage(
          `Job is ${updatedJob.status}. Progress: ${updatedJob.progress}%`,
        );
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Could not read the job update.",
        );
      }
    };

    socket.onerror = () => {
      setMessage("WebSocket connection failed.");
    };

    socket.onclose = () => {
      if (shouldShowClosedMessage) {
        setMessage("WebSocket connection closed.");
      }
    };
  }

  function selectFile(file: File | null) {
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
      await uploadAudioFile(
        presignData.uploadUrl,
        selectedFile,
        contentType,
      );

      setMessage("Creating processing job...");
      const createdJob = await createProcessingJob(
        selectedFile.name,
        presignData.objectKey,
      );

      setJob(createdJob);
      connectJobWebSocket(createdJob.id);
      setMessage("Job created. The worker will process it in the background.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Something went wrong.",
      );
    } finally {
      setIsUploading(false);
    }
  }

  return {
    backendHealth,
    downloadUrls,
    isUploading,
    job,
    message,
    selectedFile,
    sessionReady,
    selectFile,
    startProcessing,
  };
}

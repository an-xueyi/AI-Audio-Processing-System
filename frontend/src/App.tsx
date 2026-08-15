import { useEffect, useState } from "react";
import { API_BASE_URL, WS_BASE_URL } from "./config";

type HealthResponse = {
  status: string;
  service: string;
};

type PresignResponse = {
  uploadUrl: string;
  objectKey: string;
  bucket: string;
  expiresInSeconds: number;
  maxUploadBytes: number;
};

type Job = {
  id: string;
  original_file_name: string;
  input_object_key: string;
  status: string;
  progress: number;
  result_object_keys: Record<string, string> | null;
  error_message: string | null;
};

type DownloadUrlsResponse = {
  jobId: string;
  downloadUrls: Record<string, string>;
  expiresInSeconds: number;
};

type ApiErrorResponse = {
  error?: string;
};

const fallbackAudioContentTypes: Record<string, string> = {
  aac: "audio/aac",
  flac: "audio/flac",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
};

function getAudioContentType(file: File): string {
  if (file.type) {
    return file.type;
  }

  const extension = file.name.toLowerCase().split(".").pop();
  return extension ? fallbackAudioContentTypes[extension] || "" : "";
}

type JobWebSocketMessage =
  | {
      type: "job_update";
      job: Job;
    }
  | {
      type: "error";
      error: string;
    };

function App() {
  const [backendHealth, setBackendHealth] = useState<HealthResponse | null>(
    null,
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [message, setMessage] = useState<string>("Checking backend...");
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [sessionReady, setSessionReady] = useState<boolean>(false);
  const [downloadUrls, setDownloadUrls] = useState<Record<
    string,
    string
  > | null>(null);

  async function getApiErrorMessage(response: Response, fallback: string) {
    try {
      const data = (await response.json()) as ApiErrorResponse;
      return data.error || fallback;
    } catch {
      return fallback;
    }
  }

  useEffect(() => {
    async function initializeApplication() {
      try {
        const sessionResponse = await fetch(`${API_BASE_URL}/api/session`, {
          method: "POST",
          credentials: "include",
        });

        if (!sessionResponse.ok) {
          throw new Error("Could not create a secure browser session");
        }

        const response = await fetch(`${API_BASE_URL}/health`);

        if (!response.ok) {
          throw new Error("Backend health check failed");
        }

        const data = (await response.json()) as HealthResponse;
        setBackendHealth(data);
        setSessionReady(true);
        setMessage("Backend is connected.");
      } catch {
        setSessionReady(false);
        setMessage("Could not connect to backend.");
      }
    }

    void initializeApplication();
  }, []);

  async function fetchDownloadUrls(jobId: string) {
    const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/downloads`, {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(
        await getApiErrorMessage(response, "Failed to fetch download URLs"),
      );
    }

    const data = (await response.json()) as DownloadUrlsResponse;
    setDownloadUrls(data.downloadUrls);
  }

  function connectJobWebSocket(jobId: string) {
    const socket = new WebSocket(`${WS_BASE_URL}/ws/jobs?jobId=${jobId}`);

    let shouldShowClosedMessage = true;

    socket.onopen = () => {
      setMessage("Connected to job status updates.");
    };

    socket.onmessage = async (event) => {
      const message = JSON.parse(event.data) as JobWebSocketMessage;

      if (message.type === "error") {
        setMessage(message.error);
        shouldShowClosedMessage = false;
        socket.close();
        return;
      }

      setJob(message.job);

      if (message.job.status === "COMPLETED") {
        await fetchDownloadUrls(message.job.id);
        setMessage("Job completed! Download links are ready.");
        shouldShowClosedMessage = false;
        socket.close();
        return;
      }

      if (message.job.status === "FAILED") {
        setMessage(
          message.job.error_message
            ? `Job failed: ${message.job.error_message}`
            : "Job failed.",
        );
        shouldShowClosedMessage = false;
        socket.close();
        return;
      }

      setMessage(
        `Job is ${message.job.status}. Progress: ${message.job.progress}%`,
      );
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

  async function handleUploadAndCreateJob() {
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

      const presignResponse = await fetch(
        `${API_BASE_URL}/api/uploads/presign`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fileName: selectedFile.name,
            contentType,
            fileSize: selectedFile.size,
          }),
        },
      );

      if (!presignResponse.ok) {
        throw new Error(
          await getApiErrorMessage(presignResponse, "Failed to get upload URL"),
        );
      }

      const presignData = (await presignResponse.json()) as PresignResponse;

      setMessage("Uploading file to object storage...");

      const uploadResponse = await fetch(presignData.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": contentType,
        },
        body: selectedFile,
      });

      if (!uploadResponse.ok) {
        throw new Error("Failed to upload file to object storage");
      }

      setMessage("Creating processing job...");

      const jobResponse = await fetch(`${API_BASE_URL}/api/jobs`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          originalFileName: selectedFile.name,
          inputObjectKey: presignData.objectKey,
        }),
      });

      if (!jobResponse.ok) {
        throw new Error(
          await getApiErrorMessage(jobResponse, "Failed to create job"),
        );
      }

      const createdJob = (await jobResponse.json()) as Job;

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

  return (
    <main className="app-shell">
      <section className="hero-section">
        <p className="eyebrow">Distributed AI Audio Processing System</p>
        <h1>Upload audio. Track processing. Download separated stems.</h1>
        <p className="hero-copy">
          A full-stack audio processing pipeline using React, Express,
          PostgreSQL, MinIO, Kafka, WebSockets, and a Python worker.
        </p>
      </section>

      <section className="panel">
        <div className="section-header">
          <h2>System Status</h2>
          <span
            className={
              backendHealth ? "status-pill online" : "status-pill offline"
            }
          >
            {backendHealth ? "Connected" : "Disconnected"}
          </span>
        </div>
        <p>
          {backendHealth
            ? `${backendHealth.service} is ${backendHealth.status}`
            : message}
        </p>
      </section>

      <section className="panel">
        <div className="section-header">
          <h2>Upload Audio</h2>
        </div>

        <input
          className="file-input"
          type="file"
          accept="audio/*"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            setSelectedFile(file);
            setJob(null);
            setDownloadUrls(null);
            setMessage(
              file
                ? `Selected file: ${file.name}`
                : "Please choose an audio file",
            );
          }}
        />

        <button
          className="primary-button"
          type="button"
          onClick={handleUploadAndCreateJob}
          disabled={!selectedFile || isUploading || !sessionReady}
        >
          {isUploading ? "Uploading..." : "Upload and Create Job"}
        </button>

        <p className="message">{message}</p>
      </section>

      {job && (
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
      )}

      {downloadUrls && (
        <section className="panel">
          <div className="section-header">
            <h2>Download Results</h2>
          </div>

          <ul className="download-list">
            {Object.entries(downloadUrls).map(([stemName, url]) => (
              <li key={stemName}>
                <a href={url} target="_blank" rel="noreferrer">
                  Download {stemName}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

export default App;

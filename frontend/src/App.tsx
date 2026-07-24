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
  const [downloadUrls, setDownloadUrls] = useState<Record<
    string,
    string
  > | null>(null);

  useEffect(() => {
    async function checkBackendHealth() {
      try {
        const response = await fetch(`${API_BASE_URL}/health`);

        if (!response.ok) {
          throw new Error("Backend health check failed");
        }

        const data = (await response.json()) as HealthResponse;
        setBackendHealth(data);
        setMessage("Backend is connected.");
      } catch (error) {
        setMessage("Could not connect to backend.");
      }
    }

    checkBackendHealth();
  }, []);

  async function fetchDownloadUrls(jobId: string) {
    const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/downloads`);

    if (!response.ok) {
      throw new Error("Failed to fetch download URLs");
    }

    const data = (await response.json()) as DownloadUrlsResponse;
    setDownloadUrls(data.downloadUrls);
  }

  function connectJobWebSocket(jobId: string) {
    const socket = new WebSocket(`${WS_BASE_URL}/ws/jobs?jobId=${jobId}`);

    socket.onopen = () => {
      setMessage("Connected to job status updates.");
    };

    socket.onmessage = async (event) => {
      const message = JSON.parse(event.data) as JobWebSocketMessage;

      if (message.type === "error") {
        setMessage(message.error);
        socket.close();
        return;
      }

      setJob(message.job);

      if (message.job.status === "COMPLETED") {
        await fetchDownloadUrls(message.job.id);
        setMessage("Job completed! Download links are ready.");
        socket.close();
        return;
      }

      if (message.job.status === "FAILED") {
        setMessage(
          message.job.error_message
            ? `Job failed: ${message.job.error_message}`
            : "Job failed.",
        );
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
      setMessage("WebSocket connection closed.");
    };
  }

  async function handleUploadAndCreateJob() {
    if (!selectedFile) {
      setMessage("Please choose an audio file first.");
      return;
    }

    try {
      setIsUploading(true);
      setMessage("Requesting presigned URL...");

      const presignResponse = await fetch(
        `${API_BASE_URL}/api/uploads/presign`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fileName: selectedFile.name,
            contentType: selectedFile.type || "application/octet-stream",
          }),
        },
      );

      if (!presignResponse.ok) {
        throw new Error("Failed to get upload URL");
      }

      const presignData = (await presignResponse.json()) as PresignResponse;

      setMessage("Uploading file to object storage...");

      const uploadResponse = await fetch(presignData.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": selectedFile.type || "application/octet-stream",
        },
        body: selectedFile,
      });

      if (!uploadResponse.ok) {
        throw new Error("Failed to upload file to object storage");
      }

      setMessage("Creating processing job...");

      const jobResponse = await fetch(`${API_BASE_URL}/api/jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          originalFileName: selectedFile.name,
          inputObjectKey: presignData.objectKey,
        }),
      });

      if (!jobResponse.ok) {
        throw new Error("Failed to create job");
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
    <main>
      <h1>AI Audio Processing System</h1>

      <section>
        <h2>Backend Status</h2>

        {backendHealth ? (
          <p>
            Backend is connected: {backendHealth.service} is{" "}
            {backendHealth.status}
          </p>
        ) : (
          <p>{message}</p>
        )}
      </section>

      <section>
        <h2>Upload Audio</h2>

        <input
          type="file"
          accept="audio/*"
          onChange={(event) => {
            setSelectedFile(event.target.files?.[0] ?? null);
            setJob(null);
            setDownloadUrls(null);
          }}
        />

        <button
          type="button"
          onClick={handleUploadAndCreateJob}
          disabled={!selectedFile || isUploading}
        >
          {isUploading ? "Uploading..." : "Upload and Create Job"}
        </button>

        <p>{message}</p>
      </section>

      {job && (
        <section>
          <h2>Created Job</h2>
          <p>Job ID: {job.id}</p>
          <p>Status: {job.status}</p>
          <p>Progress: {job.progress}%</p>
          <p>Input Object Key: {job.input_object_key}</p>
          {job.error_message && <p>Error: {job.error_message}</p>}
        </section>
      )}

      {downloadUrls && (
        <section>
          <h2>Download Results</h2>
          <ul>
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

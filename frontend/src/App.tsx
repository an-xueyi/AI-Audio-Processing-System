import { useEffect, useState } from "react";

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
};

function App() {
  const [backendHealth, setBackendHealth] = useState<HealthResponse | null>(
    null,
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [message, setMessage] = useState<string>("Checking backend...");
  const [isUploading, setIsUploading] = useState<boolean>(false);

  useEffect(() => {
    async function checkBackendHealth() {
      try {
        const response = await fetch("http://localhost:4000/health");

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

  async function fetchJobById(jobId: string) {
    const response = await fetch(`http://localhost:4000/api/jobs/${jobId}`);

    if (!response.ok) {
      throw new Error("Failed to fetch job status");
    }

    const updatedJob = (await response.json()) as Job;
    setJob(updatedJob);

    return updatedJob;
  }

  async function pollJobUntilCompleted(jobId: string) {
    const maxAttempts = 20;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const updatedJob = await fetchJobById(jobId);

      if (updatedJob.status === "COMPLETED" || updatedJob.status === "FAILED") {
        setMessage(`Job finished with status: ${updatedJob.status}`);
        return;
      }

      setMessage(
        `Job is ${updatedJob.status}. Progress: ${updatedJob.progress}%`,
      );

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    setMessage("Stopped checking job status. You can refresh manually later.");
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
        "http://localhost:4000/api/uploads/presign",
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

      const jobResponse = await fetch("http://localhost:4000/api/jobs", {
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
      pollJobUntilCompleted(createdJob.id);
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
        </section>
      )}
    </main>
  );
}

export default App;

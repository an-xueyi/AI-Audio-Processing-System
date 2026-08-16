import { API_BASE_URL } from "../config";
import type {
  ApiErrorResponse,
  DownloadUrlsResponse,
  HealthResponse,
  Job,
  PresignResponse,
} from "../types";

async function getApiErrorMessage(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as ApiErrorResponse;
    return data.error || fallback;
  } catch {
    return fallback;
  }
}

export async function createBrowserSession(): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/session`, {
    method: "POST",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Could not create a secure browser session");
  }
}

export async function fetchBackendHealth(): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE_URL}/health`);

  if (!response.ok) {
    throw new Error("Backend health check failed");
  }

  return (await response.json()) as HealthResponse;
}

export async function requestPresignedUpload(
  file: File,
  contentType: string,
): Promise<PresignResponse> {
  const response = await fetch(`${API_BASE_URL}/api/uploads/presign`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fileName: file.name,
      contentType,
      fileSize: file.size,
    }),
  });

  if (!response.ok) {
    throw new Error(
      await getApiErrorMessage(response, "Failed to get upload URL"),
    );
  }

  return (await response.json()) as PresignResponse;
}

export async function uploadAudioFile(
  uploadUrl: string,
  file: File,
  contentType: string,
): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
    },
    body: file,
  });

  if (!response.ok) {
    throw new Error("Failed to upload file to object storage");
  }
}

export async function createProcessingJob(
  originalFileName: string,
  inputObjectKey: string,
): Promise<Job> {
  const response = await fetch(`${API_BASE_URL}/api/jobs`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      originalFileName,
      inputObjectKey,
    }),
  });

  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, "Failed to create job"));
  }

  return (await response.json()) as Job;
}

export async function fetchDownloadUrls(
  jobId: string,
): Promise<Record<string, string>> {
  const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/downloads`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(
      await getApiErrorMessage(response, "Failed to fetch download URLs"),
    );
  }

  const data = (await response.json()) as DownloadUrlsResponse;
  return data.downloadUrls;
}

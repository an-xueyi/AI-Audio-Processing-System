/*
 * All browser network requests live in this module. UI code calls named
 * functions such as createProcessingJob instead of repeating URLs, HTTP
 * methods, cookie options, JSON parsing, and error handling in components.
 */
import { API_BASE_URL } from "../config";
import type {
  DownloadUrlsResponse,
  HealthResponse,
  Job,
  JobHistoryResponse,
  PresignResponse,
} from "../types";
import { getApiErrorMessage } from "./apiErrors";

export async function createBrowserSession(): Promise<void> {
  // POST asks the backend to create a new session or refresh an existing cookie.
  const response = await fetch(`${API_BASE_URL}/api/session`, {
    method: "POST",
    // The frontend and backend use different local ports, which are different
    // origins. `include` allows the browser to receive and send the session cookie.
    credentials: "include",
  });

  // ok is true for HTTP status 200-299. Other statuses become JavaScript errors
  // so the hook can present one consistent failure path.
  if (!response.ok) {
    throw new Error("Could not create a secure browser session");
  }
}

export async function fetchBackendHealth(): Promise<HealthResponse> {
  // A GET request is fetch's default, so no method option is required here.
  const response = await fetch(`${API_BASE_URL}/health`);

  if (!response.ok) {
    throw new Error("Backend health check failed");
  }

  // Wait for the response body to be parsed, then describe its expected type.
  return (await response.json()) as HealthResponse;
}

export async function requestPresignedUpload(
  file: File,
  contentType: string,
): Promise<PresignResponse> {
  // This request sends metadata only; the File bytes are not included.
  const response = await fetch(`${API_BASE_URL}/api/uploads/presign`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    // fetch sends text over the network. JSON.stringify converts this object to
    // the JSON text declared by the Content-Type header.
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

  // The response contains temporary uploadUrl and permanent private objectKey.
  return (await response.json()) as PresignResponse;
}

export async function uploadAudioFile(
  uploadUrl: string,
  file: File,
  contentType: string,
): Promise<void> {
  // uploadUrl points to MinIO/S3, not Express. The browser transfers the File
  // directly, so the backend handles only small control messages.
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
    },
    // File is a Blob, so fetch can stream its bytes as the request body without
    // converting the audio to JSON or base64.
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
  // The new job references an object already present in storage. Express verifies
  // that object before committing the database job and outbox event.
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

export async function cancelProcessingJob(jobId: string): Promise<Job> {
  // Put the job UUID in the route path and include the ownership session cookie.
  const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/cancel`, {
    method: "POST",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, "Failed to cancel job"));
  }

  return (await response.json()) as Job;
}

export async function fetchDownloadUrls(
  jobId: string,
): Promise<Record<string, string>> {
  // Download links are requested only after completion because each link is
  // short-lived and should be generated as late as possible.
  const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/downloads`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(
      await getApiErrorMessage(response, "Failed to fetch download URLs"),
    );
  }

  // `as` tells TypeScript how this parsed JSON should be treated. It does not
  // alter the response or perform runtime validation.
  const data = (await response.json()) as DownloadUrlsResponse;
  return data.downloadUrls;
}

export async function fetchJob(jobId: string): Promise<Job> {
  // This ordinary HTTP endpoint is the fallback when realtime WebSocket delivery
  // cannot be maintained.
  const response = await fetch(`${API_BASE_URL}/api/jobs/${jobId}`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(
      await getApiErrorMessage(response, "Failed to fetch job status"),
    );
  }

  return (await response.json()) as Job;
}

export async function fetchJobHistory(): Promise<Job[]> {
  /*
   * Ask for jobs owned by the current signed browser session. No owner ID is
   * placed in this URL: the browser sends the HttpOnly session cookie, and the
   * backend derives ownership from that verified cookie.
   */
  const response = await fetch(`${API_BASE_URL}/api/jobs`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(
      await getApiErrorMessage(response, "Failed to load job history"),
    );
  }

  // Extract the array from { jobs: [...] } so callers work directly with Job[].
  const data = (await response.json()) as JobHistoryResponse;
  return data.jobs;
}

/*
 * Shared descriptions of JSON exchanged with the backend. These TypeScript
 * types help during development but do not validate network responses at
 * runtime because all type information is removed from the browser bundle.
 */
export type HealthResponse = {
  status: string;
  service: string;
};

export type PresignResponse = {
  uploadUrl: string;
  objectKey: string;
  bucket: string;
  expiresInSeconds: number;
  maxUploadBytes: number;
};

export type JobStatus =
  | "PENDING"
  | "PROCESSING"
  | "RETRYING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type Job = {
  id: string;
  original_file_name: string;
  input_object_key: string;
  status: JobStatus;
  progress: number;
  result_object_keys: Record<string, string> | null;
  error_message: string | null;
};

export type DownloadUrlsResponse = {
  jobId: string;
  downloadUrls: Record<string, string>;
  expiresInSeconds: number;
};

export type ApiErrorResponse = {
  error?: string;
};

export type JobWebSocketMessage =
  // This union lists every message shape the server may send. Checking `type`
  // later narrows the value to the fields belonging to that specific message.
  | {
      type: "connection_ready";
      heartbeatIntervalSeconds: number;
    }
  | {
      type: "subscribed";
      jobId: string;
    }
  | {
      type: "unsubscribed";
    }
  | {
      type: "job_update";
      job: Job;
    }
  | {
      type: "error";
      error: string;
    };

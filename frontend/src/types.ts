/*
 * Shared descriptions of JSON exchanged with the backend. These TypeScript
 * types help during development but do not validate network responses at
 * runtime because all type information is removed from the browser bundle.
 */
export type HealthResponse = {
  status: string;
  service: string;
};

export type WorkerAvailability = {
  // available means at least one worker is idle, busy means every online worker
  // has a job, and offline means no recent worker heartbeat exists.
  status: "available" | "busy" | "offline";
  onlineWorkers: number;
  idleWorkers: number;
  busyWorkers: number;
};

export type User = {
  // id is the permanent backend-generated UUID used to own account jobs.
  id: string;
  // username is normalized to lower case by the backend during registration.
  username: string;
};

export type AuthenticationResponse =
  | {
      authenticated: true;
      user: User;
    }
  | {
      authenticated: false;
      user: null;
    };

export type AccountSession = {
  // This UUID identifies the database session row, not its secret cookie token.
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  // The server compares token fingerprints and returns only this safe Boolean.
  isCurrent: boolean;
};

export type AccountSessionsResponse = {
  sessions: AccountSession[];
};

export type RevokeSessionsResponse = AccountSessionsResponse & {
  revokedCount: number;
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
  // A terminal job retains private audio until this server-generated time.
  storage_expires_at: string | null;
  // A non-null deletion time confirms that background cleanup removed the files.
  storage_deleted_at: string | null;
  // PostgreSQL timestamps arrive in browser JSON as ISO-formatted strings.
  created_at: string;
  updated_at: string;
};

export type JobHistoryResponse = {
  // The backend orders this array from newest job to oldest job.
  jobs: Job[];
};

export type DownloadUrlsResponse = {
  jobId: string;
  downloadUrls: Record<string, string>;
  expiresInSeconds: number;
};

export type ApiErrorResponse = {
  error?: string;
  // Unexpected backend failures include this safe identifier. It points to one
  // server log record but reveals no stack trace, password, or storage location.
  requestId?: string;
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

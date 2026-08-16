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

export type Job = {
  id: string;
  original_file_name: string;
  input_object_key: string;
  status: string;
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

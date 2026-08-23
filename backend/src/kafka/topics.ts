import dotenv from "dotenv";

dotenv.config();

export const jobCreatedTopic =
  process.env.KAFKA_JOB_CREATED_TOPIC || "audio.jobs.created";

export const jobStatusTopic =
  process.env.KAFKA_JOB_STATUS_TOPIC || "audio.jobs.status";

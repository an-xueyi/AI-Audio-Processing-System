/* Kafka topic names are configurable so environments can use separate topics. */
import dotenv from "dotenv";

dotenv.config();

// Created events tell the worker group that a new audio job is ready.
export const jobCreatedTopic =
  process.env.KAFKA_JOB_CREATED_TOPIC || "audio.jobs.created";

// Status events tell every backend replica to refresh subscribed WebSockets.
export const jobStatusTopic =
  process.env.KAFKA_JOB_STATUS_TOPIC || "audio.jobs.status";

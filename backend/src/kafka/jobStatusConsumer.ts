/* Consume worker status notifications and trigger local WebSocket refreshes. */
import { Kafka } from "kafkajs";
import { z } from "zod";
import { logger } from "../observability/logger.js";
import { createKafkaClientConfiguration } from "./clientConfiguration.js";
import { jobStatusTopic } from "./topics.js";

const groupPrefix =
  process.env.KAFKA_STATUS_CONSUMER_GROUP_PREFIX || "audio-backend-status";
// HOSTNAME differs for every Docker replica and the process ID distinguishes
// multiple manually started Node processes on one computer.
const instanceId = process.env.HOSTNAME || `local-${process.pid}`;

// Only a UUID jobId is needed. strict rejects extra fields, keeping this internal
// event contract intentionally small.
const statusEventSchema = z
  .object({
    jobId: z.string().uuid(),
  })
  .strict();

const kafka = new Kafka(
  createKafkaClientConfiguration(`audio-backend-status-${instanceId}`),
);

/*
 * Kafka normally gives each message to only one consumer inside a consumer
 * group. That behavior is correct for Python workers because a processing job
 * should run once. It is different for backend WebSocket servers: every backend
 * replica may have browsers connected to it, so every replica must hear every
 * status event and notify its own clients. Adding instanceId creates one group
 * per backend replica, turning these status events into a broadcast.
 */
const consumer = kafka.consumer({
  groupId: `${groupPrefix}-${instanceId}`,
});

// Promises are saved separately: startPromise represents connection/subscription
// startup, while runPromise represents the long-lived message-processing loop.
let startPromise: Promise<void> | null = null;
let runPromise: Promise<void> | null = null;

export async function startJobStatusConsumer(
  notifyJobChanged: (jobId: string) => Promise<void>,
) {
  if (!startPromise) {
    // Save the startup promise so two callers cannot connect and start the same
    // Kafka consumer twice. A failed start clears it so a later retry is allowed.
    startPromise = (async () => {
      // Open the network connection and join this replica's consumer group.
      await consumer.connect();

      // Subscribe only to new status events. A browser receives current state
      // through its initial database read, so old topic history is unnecessary.
      await consumer.subscribe({
        topic: jobStatusTopic,
        fromBeginning: false,
      });

      // consumer.run starts KafkaJS's long-lived polling loop.
      runPromise = consumer.run({
        eachMessage: async ({ message }) => {
          // Tombstone records can have a null value and contain no event to parse.
          if (!message.value) {
            return;
          }

          // Kafka messages are bytes. Convert those bytes to text, parse the
          // JSON, and then validate its shape before trusting jobId.
          let parsedJson: unknown;

          try {
            parsedJson = JSON.parse(message.value.toString());
          } catch {
            logger.warn("job_status_event_invalid_json");
            return;
          }

          // Runtime validation protects downstream code from malformed producers.
          const parsedEvent = statusEventSchema.safeParse(parsedJson);

          if (!parsedEvent.success) {
            logger.warn("job_status_event_invalid_payload");
            return;
          }

          // Ask this replica to query PostgreSQL and update only its own matching
          // WebSocket clients.
          await notifyJobChanged(parsedEvent.data.jobId);
        },
      });

      // runPromise lasts until stop or failure. Attach a handler so an unexpected
      // rejection is logged instead of becoming an unhandled Promise rejection.
      void runPromise.catch((error) => {
        logger.error("job_status_consumer_stopped", { error });
      });

      logger.info("job_status_consumer_started", { topic: jobStatusTopic });
    })().catch((error) => {
      // Allow a future start attempt after failed startup instead of preserving a
      // permanently rejected Promise.
      startPromise = null;
      throw error;
    });
  }

  // Existing and new callers all wait for the same startup operation.
  await startPromise;
}

export async function stopJobStatusConsumer() {
  // A null startPromise means this consumer was never started or already stopped.
  if (!startPromise) {
    return;
  }

  try {
    // Wait for an in-progress connection before requesting a clean stop.
    await startPromise;
    await consumer.stop();

    if (runPromise) {
      // stop normally resolves runPromise. Ignore its error here because the
      // unexpected-failure handler above already logged it.
      await runPromise.catch(() => undefined);
    }

    await consumer.disconnect();
  } finally {
    // Reset module state whether disconnect succeeds or throws.
    startPromise = null;
    runPromise = null;
  }
}

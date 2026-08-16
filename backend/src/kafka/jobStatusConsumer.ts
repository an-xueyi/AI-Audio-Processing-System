import { Kafka } from "kafkajs";
import { z } from "zod";

const kafkaBroker = process.env.KAFKA_BROKER || "localhost:9092";
const jobStatusTopic =
  process.env.KAFKA_JOB_STATUS_TOPIC || "audio.jobs.status";
const groupPrefix =
  process.env.KAFKA_STATUS_CONSUMER_GROUP_PREFIX || "audio-backend-status";
const instanceId = process.env.HOSTNAME || `local-${process.pid}`;

const statusEventSchema = z
  .object({
    jobId: z.string().uuid(),
  })
  .strict();

const kafka = new Kafka({
  clientId: `audio-backend-status-${instanceId}`,
  brokers: [kafkaBroker],
});

const consumer = kafka.consumer({
  groupId: `${groupPrefix}-${instanceId}`,
});

let startPromise: Promise<void> | null = null;
let runPromise: Promise<void> | null = null;

export async function startJobStatusConsumer(
  notifyJobChanged: (jobId: string) => Promise<void>,
) {
  if (!startPromise) {
    startPromise = (async () => {
      await consumer.connect();
      await consumer.subscribe({
        topic: jobStatusTopic,
        fromBeginning: false,
      });

      runPromise = consumer.run({
        eachMessage: async ({ message }) => {
          if (!message.value) {
            return;
          }

          let parsedJson: unknown;

          try {
            parsedJson = JSON.parse(message.value.toString());
          } catch {
            console.error("Ignoring invalid job status event JSON");
            return;
          }

          const parsedEvent = statusEventSchema.safeParse(parsedJson);

          if (!parsedEvent.success) {
            console.error("Ignoring invalid job status event payload");
            return;
          }

          await notifyJobChanged(parsedEvent.data.jobId);
        },
      });

      void runPromise.catch((error) => {
        console.error("Job status consumer stopped unexpectedly:", error);
      });

      console.log(`Listening for job status events on ${jobStatusTopic}`);
    })().catch((error) => {
      startPromise = null;
      throw error;
    });
  }

  await startPromise;
}

export async function stopJobStatusConsumer() {
  if (!startPromise) {
    return;
  }

  try {
    await startPromise;
    await consumer.stop();

    if (runPromise) {
      await runPromise.catch(() => undefined);
    }

    await consumer.disconnect();
  } finally {
    startPromise = null;
    runPromise = null;
  }
}

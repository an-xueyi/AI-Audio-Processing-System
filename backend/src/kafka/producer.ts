/* Manage the backend's shared Kafka producer and its connection lifecycle. */
import dotenv from "dotenv";
import { Kafka } from "kafkajs";

dotenv.config();

const kafkaBroker = process.env.KAFKA_BROKER || "localhost:9092";

const kafka = new Kafka({
  // clientId helps identify this producer in Kafka broker logs.
  clientId: "audio-backend",
  // KafkaJS accepts an array so production can list multiple bootstrap brokers.
  brokers: [kafkaBroker],
});

// Create one reusable producer object; the function below connects it lazily.
export const producer = kafka.producer();

let connectionPromise: Promise<void> | null = null;

export async function connectKafkaProducer() {
  // KafkaJS producers are designed to be reused. Saving the Promise also means
  // simultaneous callers wait for the same connection attempt instead of each
  // opening a separate connection to the broker.
  if (!connectionPromise) {
    connectionPromise = producer.connect().catch((error) => {
      // Clear a failed Promise so a later outbox pass can retry connection.
      connectionPromise = null;
      throw error;
    });
  }
  await connectionPromise;
}

export async function disconnectKafkaProducer() {
  if (!connectionPromise) {
    return;
  }

  try {
    // Startup may still be in progress during shutdown, so wait for it before
    // asking KafkaJS to disconnect the producer cleanly.
    await connectionPromise;
    await producer.disconnect();
  } finally {
    connectionPromise = null;
  }
}

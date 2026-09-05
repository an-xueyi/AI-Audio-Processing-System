/* Manage the backend's shared Kafka producer and its connection lifecycle. */
import { Kafka } from "kafkajs";
import { createKafkaClientConfiguration } from "./clientConfiguration.js";

// Both the outbox producer and status consumer now share the same broker, TLS,
// and SASL rules instead of interpreting environment variables independently.
const kafka = new Kafka(createKafkaClientConfiguration("audio-backend"));

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

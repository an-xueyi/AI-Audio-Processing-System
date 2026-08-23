import dotenv from "dotenv";
import { Kafka } from "kafkajs";

dotenv.config();

const kafkaBroker = process.env.KAFKA_BROKER || "localhost:9092";

const kafka = new Kafka({
  clientId: "audio-backend",
  brokers: [kafkaBroker],
});

export const producer = kafka.producer();

let connectionPromise: Promise<void> | null = null;

export async function connectKafkaProducer() {
  if (!connectionPromise) {
    connectionPromise = producer.connect().catch((error) => {
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
    await connectionPromise;
    await producer.disconnect();
  } finally {
    connectionPromise = null;
  }
}

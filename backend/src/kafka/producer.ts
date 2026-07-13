import dotenv from "dotenv";
import { Kafka } from "kafkajs";

dotenv.config();

const kafkaBroker = process.env.KAFKA_BROKER || "localhost:9092";

export const jobCreatedTopic =
  process.env.KAFKA_JOB_CREATED_TOPIC || "audio.jobs.created";

const kafka = new Kafka({
  clientId: "audio-backend",
  brokers: [kafkaBroker],
});

export const producer = kafka.producer();

export async function connectKafkaProducer() {
  await producer.connect();
}

import { clearInterval } from "timers";
import { pool } from "../db.js";
import { connectKafkaProducer, producer } from "./producer.js";

type OutboxEvent = {
  id: string;
  topic: string;
  event_key: string;
  payload: Record<string, unknown>;
};

const configuredPublishIntervalMs = Number(
  process.env.OUTBOX_PUBLISH_INTERVAL_MS || "500",
);
const publishIntervalMs = Number.isFinite(configuredPublishIntervalMs)
  ? Math.max(100, configuredPublishIntervalMs)
  : 500;
let isPublishing = false;
let publishInterval: NodeJS.Timeout | null = null;

export async function publishPendingOutboxEvents() {
  if (isPublishing) {
    return;
  }

  isPublishing = true;

  try {
    await connectKafkaProducer();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `SELECT id, topic, event_key, payload 
        FROM outbox_events 
        WHERE status = 'PENDING' 
        ORDER BY created_at 
        LIMIT 10 
        FOR UPDATE SKIP LOCKED`,
      );

      const events = result.rows as OutboxEvent[];

      for (const event of events) {
        try {
          await producer.send({
            topic: event.topic,
            messages: [
              {
                key: event.event_key,
                value: JSON.stringify(event.payload),
              },
            ],
          });

          await client.query(
            `UPDATE outbox_events 
            SET status = 'PUBLISHED', published_at = NOW(), last_error = NULL 
            WHERE id = $1`,
            [event.id],
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          await client.query(
            `UPDATE outbox_events 
            SET attempts = attempts + 1, last_error = $2 
            WHERE id = $1`,
            [event.id, errorMessage],
          );
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Outbox publishing failed:", error);
  } finally {
    isPublishing = false;
  }
}

export function startOutboxPublisher() {
  if (publishInterval) {
    return;
  }

  void publishPendingOutboxEvents();

  publishInterval = setInterval(() => {
    void publishPendingOutboxEvents();
  }, publishIntervalMs);
}

export async function stopOutboxPublisher() {
  if (publishInterval) {
    clearInterval(publishInterval);
    publishInterval = null;
  }

  while (isPublishing) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

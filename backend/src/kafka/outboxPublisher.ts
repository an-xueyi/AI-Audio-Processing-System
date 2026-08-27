/* Repeatedly move durable PostgreSQL outbox events into Kafka. */
import { clearInterval } from "timers";
import { pool } from "../db.js";
import { connectKafkaProducer, producer } from "./producer.js";

// This type documents the columns selected from each pending outbox row.
type OutboxEvent = {
  id: string;
  topic: string;
  event_key: string;
  payload: Record<string, unknown>;
};

// Number converts the environment string to a JavaScript number.
const configuredPublishIntervalMs = Number(
  process.env.OUTBOX_PUBLISH_INTERVAL_MS || "500",
);
// Use a valid configured delay, but never poll faster than every 100 ms. The
// ternary falls back to 500 ms when Number produced NaN or Infinity.
const publishIntervalMs = Number.isFinite(configuredPublishIntervalMs)
  ? Math.max(100, configuredPublishIntervalMs)
  : 500;
// These module-level values represent this backend replica's publisher state.
let isPublishing = false;
let publishInterval: NodeJS.Timeout | null = null;

export async function publishPendingOutboxEvents() {
  // setInterval does not wait for an asynchronous callback to finish. This flag
  // prevents one backend process from starting a second publishing pass while
  // its previous database transaction is still active.
  if (isPublishing) {
    return;
  }

  // Claim this process-level publishing turn until the outer finally resets it.
  isPublishing = true;

  try {
    // Ensure the shared producer is connected before claiming database work.
    await connectKafkaProducer();

    // Reserve one pool connection because row locks belong to its transaction.
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      /*
       * Multiple backend replicas run this publisher at the same time.
       * FOR UPDATE locks each selected row until COMMIT or ROLLBACK, while
       * SKIP LOCKED makes another replica ignore those claimed rows and select
       * different work. This provides horizontal scaling without a second
       * coordinator service deciding which backend owns each outbox event.
       */
      const result = await client.query(
        `SELECT id, topic, event_key, payload 
        FROM outbox_events 
        WHERE status = 'PENDING' 
        ORDER BY created_at 
        LIMIT 10 
        FOR UPDATE SKIP LOCKED`,
      );

      // pg returns generic row objects. This assertion documents their selected
      // shape for TypeScript; it does not transform values at runtime.
      const events = result.rows as OutboxEvent[];

      // Publish each claimed row and update its durable outbox state.
      for (const event of events) {
        try {
          // event_key becomes Kafka's message key. Jobs with the same ID are
          // therefore routed consistently when the topic has many partitions.
          await producer.send({
            topic: event.topic,
            messages: [
              {
                key: event.event_key,
                value: JSON.stringify(event.payload),
              },
            ],
          });

          // Mark success only after KafkaJS resolves producer.send.
          await client.query(
            `UPDATE outbox_events 
            SET status = 'PUBLISHED', published_at = NOW(), last_error = NULL 
            WHERE id = $1`,
            [event.id],
          );
        } catch (error) {
          // catch values are unknown. Preserve Error.message when available and
          // stringify any other thrown value for the database record.
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          // Keep a failed event PENDING and record the error. The next polling
          // pass can retry it instead of silently losing the job notification.
          await client.query(
            `UPDATE outbox_events 
            SET attempts = attempts + 1, last_error = $2 
            WHERE id = $1`,
            [event.id, errorMessage],
          );
        }
      }
      // Commit all successful and failed-attempt updates, then release row locks.
      await client.query("COMMIT");
    } catch (error) {
      // Undo changes and release locks when the batch transaction itself fails.
      await client.query("ROLLBACK");
      throw error;
    } finally {
      // Return the database connection on success and on every failure path.
      client.release();
    }
  } catch (error) {
    console.error("Outbox publishing failed:", error);
  } finally {
    // Permit the next interval tick to begin another publishing pass.
    isPublishing = false;
  }
}

export function startOutboxPublisher() {
  // A non-null interval means startup already happened; do not create a duplicate.
  if (publishInterval) {
    return;
  }

  // Publish once immediately so startup does not wait for the first timer tick.
  void publishPendingOutboxEvents();

  // Then repeat for as long as this backend process is running.
  publishInterval = setInterval(() => {
    void publishPendingOutboxEvents();
  }, publishIntervalMs);
}

export async function stopOutboxPublisher() {
  // Prevent future ticks before waiting for current work to finish.
  if (publishInterval) {
    clearInterval(publishInterval);
    publishInterval = null;
  }

  // A batch may still own database locks. Check every 50 ms until its finally
  // block resets isPublishing instead of disconnecting resources underneath it.
  while (isPublishing) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

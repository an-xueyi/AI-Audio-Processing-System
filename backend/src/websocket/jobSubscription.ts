/* Validate browser commands and maintain one job subscription per WebSocket. */
import { WebSocket } from "ws";
import { logger } from "../observability/logger.js";
import { findOwnedJob } from "../services/jobService.js";
import { clientMessageSchema } from "./jobProtocol.js";

// Even when Kafka drives realtime updates, refresh from PostgreSQL every 30
// seconds as a repair path for a missed event.
const safetyRefreshIntervalMs = 30_000;

// Jobs in these states will never produce further processing progress.
const terminalStatuses = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

export type JobSubscription = {
  // The only job UUID this socket currently watches.
  jobId: string;
  // Timer for the slow database safety refresh, or null when inactive.
  safetyIntervalId: NodeJS.Timeout | null;
  // Prevent two database refresh operations from overlapping.
  isRefreshing: boolean;
  // Serialized previous message used to avoid sending duplicate job state.
  previousPayload: string;
  // Remember that an event arrived while a refresh was already running.
  refreshRequested: boolean;
};

// Intersection (`&`) extends the ws library's WebSocket with application state
// attached after authentication.
export type JobSocket = WebSocket & {
  isAlive: boolean;
  // The same server-resolved owner used by HTTP job routes.
  ownerId: string;
  subscriptionVersion: number;
  subscription?: JobSubscription;
};

export function sendJson(socket: WebSocket, message: object) {
  // send is legal only after the connection is open. Silently skipping a closed
  // socket avoids throwing while shutdown or disconnection is in progress.
  if (socket.readyState === WebSocket.OPEN) {
    // WebSockets carry text or binary data, so convert the object to JSON text.
    socket.send(JSON.stringify(message));
  }
}

export function clearSubscription(socket: JobSocket) {
  // Optional chaining reaches the timer only when a subscription currently exists.
  if (socket.subscription?.safetyIntervalId) {
    // Stop future database refreshes before removing the subscription object.
    clearInterval(socket.subscription.safetyIntervalId);
  }

  // delete removes this optional property entirely from the socket object.
  delete socket.subscription;
}

function sendJobUpdate(
  socket: JobSocket,
  subscription: JobSubscription,
  job: Record<string, unknown>,
) {
  // Build exactly the JSON text that would be sent to the browser.
  const payload = JSON.stringify({ type: "job_update", job });

  // Send only when at least one field differs from the previous complete payload.
  if (payload !== subscription.previousPayload) {
    // sendJson expects an object. Parse the already-created JSON rather than
    // constructing a second potentially different message object.
    sendJson(socket, JSON.parse(payload) as object);

    // Save this payload only after attempting its delivery.
    subscription.previousPayload = payload;
  }

  // String handles the unknown status value in Record<string, unknown>. A
  // terminal job no longer needs the slow safety polling interval.
  if (
    terminalStatuses.has(String(job.status)) &&
    subscription.safetyIntervalId
  ) {
    clearInterval(subscription.safetyIntervalId);
    // Reset to null so other code can see that no interval remains active.
    subscription.safetyIntervalId = null;
  }
}

export async function refreshSubscription(
  socket: JobSocket,
  subscription: JobSubscription,
) {
  // The caller may hold an old subscription object after the socket switched to
  // another job. Identity comparison prevents that stale work from sending data.
  if (socket.subscription !== subscription) {
    return;
  }

  /*
   * Kafka events can arrive while a database read is still active. Starting an
   * overlapping query could let an older result be sent after a newer result.
   * Instead, refreshRequested remembers that another event arrived, and the
   * do/while loop performs exactly one additional read after the current read.
   */
  if (subscription.isRefreshing) {
    subscription.refreshRequested = true;
    return;
  }

  // Claim refresh ownership before starting the asynchronous database query.
  subscription.isRefreshing = true;

  try {
    // do/while always performs at least one query. It repeats only when an event
    // set refreshRequested during the previous query.
    do {
      // Consume the pending request now; a newly arriving event may set it again.
      subscription.refreshRequested = false;

      // Ownership filtering uses the socket's verified user or visitor owner ID.
      const job = await findOwnedJob(subscription.jobId, socket.ownerId);

      // Recheck after await because the subscription may have changed while the
      // database operation was in progress.
      if (socket.subscription !== subscription) {
        return;
      }

      if (!job) {
        // Missing or unowned jobs appear identical to the client, preventing
        // another user's job UUID from revealing its existence.
        sendJson(socket, { type: "error", error: "Job not found" });
        clearSubscription(socket);
        return;
      }

      sendJobUpdate(socket, subscription, job);
    } while (subscription.refreshRequested);
  } catch (error) {
    // Keep detailed diagnostics on the server and send a generic client message.
    logger.error("websocket_job_refresh_failed", {
      error,
      jobId: subscription.jobId,
    });
    sendJson(socket, {
      type: "error",
      error: "Failed to fetch job status",
    });
  } finally {
    // Always release the refresh guard, including errors and early returns.
    subscription.isRefreshing = false;
  }
}

async function subscribeToJob(socket: JobSocket, jobId: string) {
  // Every subscribe/unsubscribe action advances a counter. It invalidates older
  // asynchronous database reads that finish after a newer user action.
  socket.subscriptionVersion += 1;

  // Capture this action's version before waiting for PostgreSQL.
  const subscriptionVersion = socket.subscriptionVersion;
  const job = await findOwnedJob(jobId, socket.ownerId);

  // If the counter changed during await, this result belongs to an obsolete action.
  if (socket.subscriptionVersion !== subscriptionVersion) {
    return;
  }

  if (!job) {
    sendJson(socket, { type: "error", error: "Job not found" });
    return;
  }

  // Remove any old job's interval before constructing the new subscription.
  clearSubscription(socket);
  const subscription: JobSubscription = {
    jobId,
    safetyIntervalId: null,
    isRefreshing: false,
    previousPayload: "",
    refreshRequested: false,
  };

  // Attach application state to this particular WebSocket connection.
  socket.subscription = subscription;

  // Confirm registration, then immediately provide current database state instead
  // of making the browser wait for the next Kafka event.
  sendJson(socket, { type: "subscribed", jobId });
  sendJobUpdate(socket, subscription, job);

  if (!terminalStatuses.has(job.status)) {
    /*
     * Kafka drives normal realtime updates. This slower database refresh is a
     * recovery mechanism: if Kafka or a backend replica restarts at an unlucky
     * moment, the browser eventually receives the current database state even
     * when one notification event was missed.
     */
    subscription.safetyIntervalId = setInterval(() => {
      // setInterval cannot await an async callback. `void` intentionally starts
      // refreshSubscription while that function handles its own errors.
      void refreshSubscription(socket, subscription);
    }, safetyRefreshIntervalMs);
  }
}

export async function handleClientMessage(
  socket: JobSocket,
  rawMessage: string,
) {
  // Network text is untrusted until both JSON parsing and Zod validation succeed.
  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(rawMessage);
  } catch {
    sendJson(socket, { type: "error", error: "Message must be valid JSON" });
    return;
  }

  // safeParse returns structured success/failure without throwing for bad input.
  const parsedMessage = clientMessageSchema.safeParse(parsedJson);

  if (!parsedMessage.success) {
    sendJson(socket, { type: "error", error: "Invalid WebSocket message" });
    return;
  }

  if (parsedMessage.data.type === "unsubscribe") {
    // Invalidate any subscribe database query that may still be running.
    socket.subscriptionVersion += 1;
    clearSubscription(socket);
    sendJson(socket, { type: "unsubscribed" });
    return;
  }

  // The validated alternative that remains is necessarily a subscribe message.
  await subscribeToJob(socket, parsedMessage.data.jobId);
}

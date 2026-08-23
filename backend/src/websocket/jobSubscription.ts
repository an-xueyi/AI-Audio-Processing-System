import { WebSocket } from "ws";
import { findOwnedJob } from "../services/jobService.js";
import { clientMessageSchema } from "./jobProtocol.js";

const safetyRefreshIntervalMs = 30_000;
const terminalStatuses = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

export type JobSubscription = {
  jobId: string;
  safetyIntervalId: NodeJS.Timeout | null;
  isRefreshing: boolean;
  previousPayload: string;
  refreshRequested: boolean;
};

export type JobSocket = WebSocket & {
  isAlive: boolean;
  sessionId: string;
  subscriptionVersion: number;
  subscription?: JobSubscription;
};

export function sendJson(socket: WebSocket, message: object) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

export function clearSubscription(socket: JobSocket) {
  if (socket.subscription?.safetyIntervalId) {
    clearInterval(socket.subscription.safetyIntervalId);
  }

  delete socket.subscription;
}

function sendJobUpdate(
  socket: JobSocket,
  subscription: JobSubscription,
  job: Record<string, unknown>,
) {
  const payload = JSON.stringify({ type: "job_update", job });

  if (payload !== subscription.previousPayload) {
    sendJson(socket, JSON.parse(payload) as object);
    subscription.previousPayload = payload;
  }

  if (
    terminalStatuses.has(String(job.status)) &&
    subscription.safetyIntervalId
  ) {
    clearInterval(subscription.safetyIntervalId);
    subscription.safetyIntervalId = null;
  }
}

export async function refreshSubscription(
  socket: JobSocket,
  subscription: JobSubscription,
) {
  if (socket.subscription !== subscription) {
    return;
  }

  // Kafka events can arrive while a database read is still active. Remember
  // that event and perform one more read instead of running overlapping queries.
  if (subscription.isRefreshing) {
    subscription.refreshRequested = true;
    return;
  }

  subscription.isRefreshing = true;

  try {
    do {
      subscription.refreshRequested = false;
      const job = await findOwnedJob(subscription.jobId, socket.sessionId);

      if (socket.subscription !== subscription) {
        return;
      }

      if (!job) {
        sendJson(socket, { type: "error", error: "Job not found" });
        clearSubscription(socket);
        return;
      }

      sendJobUpdate(socket, subscription, job);
    } while (subscription.refreshRequested);
  } catch (error) {
    console.error("WebSocket job refresh failed:", error);
    sendJson(socket, {
      type: "error",
      error: "Failed to fetch job status",
    });
  } finally {
    subscription.isRefreshing = false;
  }
}

async function subscribeToJob(socket: JobSocket, jobId: string) {
  socket.subscriptionVersion += 1;
  const subscriptionVersion = socket.subscriptionVersion;
  const job = await findOwnedJob(jobId, socket.sessionId);

  if (socket.subscriptionVersion !== subscriptionVersion) {
    return;
  }

  if (!job) {
    sendJson(socket, { type: "error", error: "Job not found" });
    return;
  }

  clearSubscription(socket);
  const subscription: JobSubscription = {
    jobId,
    safetyIntervalId: null,
    isRefreshing: false,
    previousPayload: "",
    refreshRequested: false,
  };

  socket.subscription = subscription;
  sendJson(socket, { type: "subscribed", jobId });
  sendJobUpdate(socket, subscription, job);

  if (!terminalStatuses.has(job.status)) {
    // Kafka drives normal updates. This slow refresh repairs state if an event
    // was missed during a broker or backend restart.
    subscription.safetyIntervalId = setInterval(() => {
      void refreshSubscription(socket, subscription);
    }, safetyRefreshIntervalMs);
  }
}

export async function handleClientMessage(
  socket: JobSocket,
  rawMessage: string,
) {
  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(rawMessage);
  } catch {
    sendJson(socket, { type: "error", error: "Message must be valid JSON" });
    return;
  }

  const parsedMessage = clientMessageSchema.safeParse(parsedJson);

  if (!parsedMessage.success) {
    sendJson(socket, { type: "error", error: "Invalid WebSocket message" });
    return;
  }

  if (parsedMessage.data.type === "unsubscribe") {
    socket.subscriptionVersion += 1;
    clearSubscription(socket);
    sendJson(socket, { type: "unsubscribed" });
    return;
  }

  await subscribeToJob(socket, parsedMessage.data.jobId);
}

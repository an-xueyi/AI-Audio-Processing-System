import type { Server } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import { readSessionId } from "../auth/session.js";
import { isAllowedOrigin } from "../config/security.js";
import { pool } from "../db.js";

const heartbeatIntervalMs = 30_000;
const jobPollIntervalMs = 1_000;
const uuidSchema = z.string().uuid();

const clientMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("subscribe"),
      jobId: uuidSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("unsubscribe"),
    })
    .strict(),
]);

type JobSubscription = {
  jobId: string;
  intervalId: NodeJS.Timeout | null;
  isPolling: boolean;
  previousPayload: string;
};

type JobSocket = WebSocket & {
  isAlive: boolean;
  sessionId: string;
  subscriptionVersion: number;
  subscription?: JobSubscription;
};

type JobUpdatesService = {
  closeClients: () => void;
  closeServer: () => Promise<void>;
};

function sendJson(socket: WebSocket, message: object) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function clearSubscription(socket: JobSocket) {
  if (socket.subscription?.intervalId) {
    clearInterval(socket.subscription.intervalId);
  }

  delete socket.subscription;
}

async function findOwnedJob(jobId: string, sessionId: string) {
  const result = await pool.query(
    `SELECT id, original_file_name, input_object_key, status, progress,
            result_object_keys, error_message, created_at, updated_at
     FROM jobs
     WHERE id = $1 AND owner_id = $2`,
    [jobId, sessionId],
  );

  return result.rows[0] ?? null;
}

function isTerminalStatus(status: string) {
  return status === "COMPLETED" || status === "FAILED";
}

function sendJobUpdate(
  socket: JobSocket,
  subscription: JobSubscription,
  job: Record<string, unknown>,
) {
  const payload = JSON.stringify({
    type: "job_update",
    job,
  });

  if (payload !== subscription.previousPayload) {
    sendJson(socket, JSON.parse(payload) as object);
    subscription.previousPayload = payload;
  }

  if (isTerminalStatus(String(job.status)) && subscription.intervalId) {
    clearInterval(subscription.intervalId);
    subscription.intervalId = null;
  }
}

async function pollSubscription(
  socket: JobSocket,
  subscription: JobSubscription,
) {
  if (subscription.isPolling || socket.subscription !== subscription) {
    return;
  }

  subscription.isPolling = true;

  try {
    const job = await findOwnedJob(subscription.jobId, socket.sessionId);

    if (socket.subscription !== subscription) {
      return;
    }

    if (!job) {
      sendJson(socket, {
        type: "error",
        error: "Job not found",
      });
      clearSubscription(socket);
      return;
    }

    sendJobUpdate(socket, subscription, job);
  } catch (error) {
    console.error("WebSocket job polling failed:", error);
    sendJson(socket, {
      type: "error",
      error: "Failed to fetch job status",
    });
  } finally {
    subscription.isPolling = false;
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
    sendJson(socket, {
      type: "error",
      error: "Job not found",
    });
    return;
  }

  clearSubscription(socket);

  const subscription: JobSubscription = {
    jobId,
    intervalId: null,
    isPolling: false,
    previousPayload: "",
  };

  socket.subscription = subscription;
  sendJson(socket, { type: "subscribed", jobId });
  sendJobUpdate(socket, subscription, job);

  if (!isTerminalStatus(job.status)) {
    subscription.intervalId = setInterval(() => {
      void pollSubscription(socket, subscription);
    }, jobPollIntervalMs);
  }
}

async function handleClientMessage(socket: JobSocket, rawMessage: string) {
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

export function createJobUpdatesService(
  httpServer: Server,
): JobUpdatesService {
  const webSocketServer = new WebSocketServer({
    server: httpServer,
    path: "/ws/jobs",
    maxPayload: 16 * 1024,
    perMessageDeflate: false,
  });

  webSocketServer.on("connection", (webSocket, request) => {
    const socket = webSocket as JobSocket;

    if (!isAllowedOrigin(request.headers.origin)) {
      sendJson(socket, {
        type: "error",
        error: "WebSocket origin is not allowed",
      });
      socket.close(1008, "Origin not allowed");
      return;
    }

    const sessionId = readSessionId(request.headers.cookie);

    if (!sessionId) {
      sendJson(socket, {
        type: "error",
        error: "A valid session is required",
      });
      socket.close(1008, "Authentication required");
      return;
    }

    socket.isAlive = true;
    socket.sessionId = sessionId;
    socket.subscriptionVersion = 0;

    socket.on("pong", () => {
      socket.isAlive = true;
    });

    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        sendJson(socket, {
          type: "error",
          error: "Binary WebSocket messages are not supported",
        });
        return;
      }

      void handleClientMessage(socket, data.toString()).catch((error) => {
        console.error("WebSocket message handling failed:", error);
        sendJson(socket, {
          type: "error",
          error: "Failed to handle WebSocket message",
        });
      });
    });

    socket.on("close", () => {
      clearSubscription(socket);
    });

    sendJson(socket, {
      type: "connection_ready",
      heartbeatIntervalSeconds: heartbeatIntervalMs / 1000,
    });
  });

  const heartbeatId = setInterval(() => {
    for (const webSocket of webSocketServer.clients) {
      const socket = webSocket as JobSocket;

      if (!socket.isAlive) {
        clearSubscription(socket);
        socket.terminate();
        continue;
      }

      socket.isAlive = false;
      socket.ping();
    }
  }, heartbeatIntervalMs);

  return {
    closeClients() {
      for (const webSocket of webSocketServer.clients) {
        const socket = webSocket as JobSocket;
        clearSubscription(socket);
        socket.close(1001, "Server shutting down");
      }
    },
    closeServer() {
      clearInterval(heartbeatId);

      return new Promise<void>((resolve) => {
        webSocketServer.close(() => resolve());
      });
    },
  };
}

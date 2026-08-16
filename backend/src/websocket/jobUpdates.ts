import type { Server } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { readSessionId } from "../auth/session.js";
import { isAllowedOrigin } from "../config/security.js";
import { clientMessageSchema } from "./jobProtocol.js";
import { findOwnedJob } from "./jobRepository.js";

const heartbeatIntervalMs = 30_000;
const safetyRefreshIntervalMs = 30_000;

type JobSubscription = {
  jobId: string;
  safetyIntervalId: NodeJS.Timeout | null;
  isRefreshing: boolean;
  previousPayload: string;
  refreshRequested: boolean;
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
  notifyJobChanged: (jobId: string) => Promise<void>;
};

function sendJson(socket: WebSocket, message: object) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function clearSubscription(socket: JobSocket) {
  if (socket.subscription?.safetyIntervalId) {
    clearInterval(socket.subscription.safetyIntervalId);
  }

  delete socket.subscription;
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

  if (
    isTerminalStatus(String(job.status)) &&
    subscription.safetyIntervalId
  ) {
    clearInterval(subscription.safetyIntervalId);
    subscription.safetyIntervalId = null;
  }
}

async function refreshSubscription(
  socket: JobSocket,
  subscription: JobSubscription,
) {
  if (socket.subscription !== subscription) {
    return;
  }

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
        sendJson(socket, {
          type: "error",
          error: "Job not found",
        });
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
    sendJson(socket, {
      type: "error",
      error: "Job not found",
    });
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

  if (!isTerminalStatus(job.status)) {
    subscription.safetyIntervalId = setInterval(() => {
      void refreshSubscription(socket, subscription);
    }, safetyRefreshIntervalMs);
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
    async notifyJobChanged(jobId: string) {
      const refreshes: Promise<void>[] = [];

      for (const webSocket of webSocketServer.clients) {
        const socket = webSocket as JobSocket;

        if (socket.subscription?.jobId === jobId) {
          refreshes.push(refreshSubscription(socket, socket.subscription));
        }
      }

      await Promise.all(refreshes);
    },
  };
}

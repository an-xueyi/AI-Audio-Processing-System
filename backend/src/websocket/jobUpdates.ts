import type { Server } from "http";
import { WebSocketServer } from "ws";
import { readSessionId } from "../auth/session.js";
import { isAllowedOrigin } from "../config/security.js";
import {
  clearSubscription,
  handleClientMessage,
  type JobSocket,
  refreshSubscription,
  sendJson,
} from "./jobSubscription.js";

const heartbeatIntervalMs = 30_000;

type JobUpdatesService = {
  closeClients: () => void;
  closeServer: () => Promise<void>;
  notifyJobChanged: (jobId: string) => Promise<void>;
};

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

/* Own the WebSocket server, connection authentication, and job broadcasts. */
import type { Server } from "http";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { resolveRequestPrincipal } from "../auth/principal.js";
import { isAllowedOrigin } from "../config/security.js";
import { logger } from "../observability/logger.js";
import {
  recordWebSocketClosed,
  recordWebSocketOpened,
} from "../observability/metrics.js";
import {
  clearSubscription,
  handleClientMessage,
  type JobSocket,
  refreshSubscription,
  sendJson,
} from "./jobSubscription.js";

// Ping each browser every 30 seconds to detect connections that vanished without
// completing the normal WebSocket close handshake.
const heartbeatIntervalMs = 30_000;

// This public interface lets server.ts use WebSockets without knowing internal
// socket storage and subscription details.
type JobUpdatesService = {
  closeClients: () => void;
  closeServer: () => Promise<void>;
  notifyJobChanged: (jobId: string) => Promise<void>;
};

export function createJobUpdatesService(
  httpServer: Server,
): JobUpdatesService {
  /*
   * A WebSocket starts as an HTTP upgrade request. Attaching WebSocketServer to
   * the existing HTTP server lets Express routes and /ws/jobs share port 4000.
   * Under Nginx, each upgraded connection remains attached to the backend
   * replica Nginx selected until the socket closes or reconnects.
   */
  const webSocketServer = new WebSocketServer({
    server: httpServer,
    path: "/ws/jobs",
    // Browser commands contain only a type and job UUID. Reject messages larger
    // than 16 KiB so this channel cannot be used for large data transfer.
    maxPayload: 16 * 1024,
    // Small JSON messages do not justify compression cost and complexity.
    perMessageDeflate: false,
  });

  // This callback runs after an HTTP request successfully upgrades to WebSocket.
  webSocketServer.on("connection", (webSocket, request) => {
    // Type assertion allows application-specific fields declared on JobSocket.
    const socket = webSocket as JobSocket;
    const connectionId = randomUUID();

    // Count every accepted TCP/WebSocket connection, including one that is later
    // rejected by origin or session policy. `once` guarantees one decrement.
    recordWebSocketOpened();
    socket.once("close", (code) => {
      recordWebSocketClosed();
      logger.info("websocket_closed", { connectionId, code });
    });

    // WebSockets are not protected by normal browser CORS enforcement, so origin
    // validation is repeated explicitly during the handshake connection event.
    if (!isAllowedOrigin(request.headers.origin)) {
      logger.warn("websocket_rejected_origin", { connectionId });
      sendJson(socket, {
        type: "error",
        error: "WebSocket origin is not allowed",
      });
      // 1008 is the standard close code for a policy violation.
      socket.close(1008, "Origin not allowed");
      return;
    }

    /*
     * Account sessions require a PostgreSQL lookup, so identity resolution is
     * asynchronous. The event emitter cannot await a Promise returned by this
     * callback; `void` starts the work and the final catch handles failures.
     */
    void (async () => {
      // The upgrade request carries the same HttpOnly cookies as HTTP requests.
      const principal = await resolveRequestPrincipal(request.headers.cookie);

      if (!principal) {
        logger.warn("websocket_rejected_session", { connectionId });
        sendJson(socket, {
          type: "error",
          error: "A valid browser session is required",
        });
        socket.close(1008, "Authentication required");
        return;
      }

      // Initialize all application fields before registering message handlers.
      socket.isAlive = true;
      socket.ownerId = principal.ownerId;
      socket.subscriptionVersion = 0;
      logger.info("websocket_connected", {
        connectionId,
        authenticated: principal.user !== null,
      });

      // The ws client automatically replies to a ping with pong. Receiving it
      // proves the connection can still communicate in both directions.
      socket.on("pong", () => {
        socket.isAlive = true;
      });

      // `data` contains message bytes and isBinary records how they were sent.
      socket.on("message", (data, isBinary) => {
        if (isBinary) {
          sendJson(socket, {
            type: "error",
            error: "Binary WebSocket messages are not supported",
          });
          return;
        }

        // Convert bytes to text, then validate and process the browser command.
        void handleClientMessage(socket, data.toString()).catch((error) => {
          logger.error("websocket_message_failed", { connectionId, error });
          sendJson(socket, {
            type: "error",
            error: "Failed to handle WebSocket message",
          });
        });
      });

      // Closing must stop its safety interval and remove subscription state.
      socket.on("close", () => {
        clearSubscription(socket);
      });

      // The browser waits for this message before sending a subscribe command.
      sendJson(socket, {
        type: "connection_ready",
        heartbeatIntervalSeconds: heartbeatIntervalMs / 1000,
      });
    })().catch((error) => {
      // Database/authentication failures close this connection without exposing
      // token, SQL, or infrastructure details to the browser.
      logger.error("websocket_authentication_failed", {
        connectionId,
        error,
      });
      sendJson(socket, {
        type: "error",
        error: "WebSocket authentication failed",
      });
      socket.close(1011, "Authentication unavailable");
    });
  });

  /*
   * A cable can disappear without sending a WebSocket close frame. Every cycle
   * the server expects a pong reply to its ping. A client that failed to answer
   * the previous cycle is terminated so dead connections do not remain in
   * memory forever. The ws client implementation replies to ping automatically.
   */
  const heartbeatId = setInterval(() => {
    // webSocketServer.clients is the current Set of connections on this replica.
    for (const webSocket of webSocketServer.clients) {
      const socket = webSocket as JobSocket;

      // isAlive remains false when the previous ping received no pong response.
      if (!socket.isAlive) {
        clearSubscription(socket);
        // terminate closes immediately without waiting for another handshake from
        // a peer that is assumed unreachable.
        socket.terminate();
        continue;
      }

      // Assume failure before pinging. The pong handler changes this back to true.
      socket.isAlive = false;
      socket.ping();
    }
  }, heartbeatIntervalMs);

  return {
    closeClients() {
      // Ask every connected browser to close normally during backend shutdown.
      for (const webSocket of webSocketServer.clients) {
        const socket = webSocket as JobSocket;
        clearSubscription(socket);
        // 1001 means the endpoint is going away, prompting clients to reconnect.
        socket.close(1001, "Server shutting down");
      }
    },
    closeServer() {
      // Stop creating ping cycles before waiting for the server to close.
      clearInterval(heartbeatId);

      // ws exposes callback-based close completion; wrap it so server.ts can await it.
      return new Promise<void>((resolve) => {
        webSocketServer.close(() => resolve());
      });
    },
    async notifyJobChanged(jobId: string) {
      // Collect refresh Promises so the Kafka message is not considered handled
      // until every matching local client has read current database state.
      const refreshes: Promise<void>[] = [];

      for (const webSocket of webSocketServer.clients) {
        const socket = webSocket as JobSocket;

        // Optional chaining handles sockets that have not subscribed to a job.
        if (socket.subscription?.jobId === jobId) {
          refreshes.push(refreshSubscription(socket, socket.subscription));
        }
      }

      // An empty array resolves immediately; otherwise refresh all matches concurrently.
      await Promise.all(refreshes);
    },
  };
}

/* Connect integration checks to the real backend WebSocket endpoint. */
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

/*
 * Integration programs run from the repository root, which has no package.json
 * or node_modules directory of its own. createRequire starts dependency lookup
 * from backend/package.json, allowing this file to reuse the same `ws` package
 * that the backend already needs. No duplicate dependency is installed.
 */
const requireFromBackend = createRequire(
  new URL("../../backend/package.json", import.meta.url),
);
const { WebSocket } = requireFromBackend("ws");

// The local backend allows requests from the Vite development website. Sending
// the same Origin header also exercises the backend's WebSocket origin check.
const frontendOrigin = "http://localhost:5173";

function createWebSocketUrl(apiBaseUrl) {
  // URL parses the configured API address into protocol, host, port, and path
  // components without depending on fragile string replacements.
  const url = new URL(apiBaseUrl);

  // WebSockets use ws with HTTP and wss with HTTPS. Local integration uses ws,
  // while this conversion remains correct for a future HTTPS environment.
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws/jobs";
  // A WebSocket endpoint in this project does not use query parameters.
  url.search = "";
  url.hash = "";
  return url.toString();
}

function parseServerMessage(rawData) {
  // The ws library may deliver text as a Buffer. String converts either a
  // Buffer or an existing string into the JSON text sent by the backend.
  const messageText = String(rawData);

  try {
    return JSON.parse(messageText);
  } catch {
    // A non-JSON message violates this application's WebSocket protocol. Fail
    // immediately instead of allowing a later timeout to hide the real problem.
    throw new Error(`Backend sent a non-JSON WebSocket message: ${messageText}`);
  }
}

export async function connectJobWebSocket(session) {
  // EventEmitter lets waitForMessage sleep until the socket receives something,
  // instead of repeatedly checking an array in a CPU-consuming loop.
  const events = new EventEmitter();
  // Preserve every parsed message so callers can inspect the complete sequence,
  // including messages that arrived just before a new wait began.
  const messages = [];
  const socket = new WebSocket(createWebSocketUrl(session.apiBaseUrl), {
    // A command-line WebSocket does not manage browser cookies automatically.
    // Supplying the signed cookie makes this connection represent the same
    // private visitor session created through POST /api/session.
    headers: {
      Cookie: session.sessionCookie,
    },
    // `origin` becomes the HTTP Origin header checked by jobUpdates.ts.
    origin: frontendOrigin,
  });

  // Decode each incoming message once, retain it, and wake interested waiters.
  socket.on("message", (rawData) => {
    try {
      const message = parseServerMessage(rawData);
      messages.push(message);
      events.emit("message", message);
    } catch (error) {
      events.emit("protocol_error", error);
    }
  });

  // Network errors and connection closure are separate events in `ws`. Forward
  // both so a waiting check fails promptly rather than waiting for its timeout.
  socket.on("error", (error) => events.emit("socket_error", error));
  socket.on("close", (code, reason) => {
    events.emit("socket_close", {
      code,
      reason: reason.toString(),
    });
  });

  function waitForMessage(
    predicate,
    description,
    { startIndex = 0, timeoutMilliseconds = 15_000 } = {},
  ) {
    // First inspect retained messages. This closes the small timing gap where a
    // fast backend response can arrive immediately before this function runs.
    const existingMessage = messages
      .slice(startIndex)
      .find((message) => predicate(message));

    if (existingMessage) {
      return Promise.resolve(existingMessage);
    }

    return new Promise((resolve, reject) => {
      // Every completion path removes listeners and the timer. Without cleanup,
      // old waits would accumulate and react to unrelated future messages.
      function cleanup() {
        clearTimeout(timeoutId);
        events.off("message", handleMessage);
        events.off("protocol_error", handleProtocolError);
        events.off("socket_error", handleSocketError);
        events.off("socket_close", handleSocketClose);
      }

      function handleMessage(message) {
        if (predicate(message)) {
          cleanup();
          resolve(message);
        }
      }

      function handleProtocolError(error) {
        cleanup();
        reject(error);
      }

      function handleSocketError(error) {
        cleanup();
        reject(new Error(`WebSocket failed while waiting for ${description}: ${error.message}`));
      }

      function handleSocketClose({ code, reason }) {
        cleanup();
        reject(
          new Error(
            `WebSocket closed while waiting for ${description}: ` +
              `code ${code}${reason ? `, reason ${reason}` : ""}`,
          ),
        );
      }

      // Rejecting with the expected message name makes a stalled test easier to
      // diagnose than a generic "timed out" error.
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for ${description}`));
      }, timeoutMilliseconds);

      events.on("message", handleMessage);
      events.on("protocol_error", handleProtocolError);
      events.on("socket_error", handleSocketError);
      events.on("socket_close", handleSocketClose);
    });
  }

  // The backend sends connection_ready only after validating origin and session
  // identity. Waiting here means callers receive a fully authenticated client.
  await waitForMessage(
    (message) => message.type === "connection_ready",
    "the authenticated connection-ready message",
  );

  return {
    socket,
    messages,
    waitForMessage,
    subscribe(jobId) {
      // Remember this position so callers can ignore connection setup messages.
      const startIndex = messages.length;
      socket.send(JSON.stringify({ type: "subscribe", jobId }));
      return startIndex;
    },
    close() {
      // CLOSED means there is nothing left to release. CLOSING means another
      // caller already began the normal close handshake.
      if (
        socket.readyState === WebSocket.CLOSED ||
        socket.readyState === WebSocket.CLOSING
      ) {
        return;
      }

      // Code 1000 identifies an intentional, successful client shutdown.
      socket.close(1000, "Integration check finished");
    },
  };
}

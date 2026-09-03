/* Public service addresses used by browser HTTP and WebSocket clients. */

/** Remove trailing slashes so callers can safely append `/api` or `/ws`. */
function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

// Vite development runs on port 5173 while the local API uses port 4000. A
// production build defaults to an empty base, which means the browser uses the
// same public HTTPS origin that served the frontend.
const defaultApiBaseUrl = import.meta.env.DEV
  ? "http://localhost:4000"
  : "";

export const API_BASE_URL = normalizeBaseUrl(
  import.meta.env.VITE_API_BASE_URL ?? defaultApiBaseUrl,
);

/** Convert an HTTP origin into the matching WebSocket origin. */
function createDefaultWebSocketBaseUrl(): string {
  // When API_BASE_URL is empty, window.location.origin represents the public
  // frontend host. A separately configured API origin is used when supplied.
  const httpUrl = new URL(API_BASE_URL || window.location.origin);
  httpUrl.protocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";
  return httpUrl.origin;
}

// Most deployments need only VITE_API_BASE_URL because the WebSocket origin can
// be derived from it. VITE_WS_BASE_URL remains available for unusual topologies.
const configuredWebSocketBaseUrl =
  import.meta.env.VITE_WS_BASE_URL?.trim();

export const WS_BASE_URL = normalizeBaseUrl(
  configuredWebSocketBaseUrl || createDefaultWebSocketBaseUrl(),
);

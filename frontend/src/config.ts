/* Public service addresses used by browser HTTP and WebSocket clients. */
// Vite exposes browser-safe variables only when their names begin with VITE_.
// The fallback values make local development work without a frontend .env file.
export const API_BASE_URL =
  // `||` uses localhost when the configured string is absent or empty.
  import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

// WebSockets use ws:// locally and wss:// when deployed behind HTTPS.
export const WS_BASE_URL =
  import.meta.env.VITE_WS_BASE_URL || "ws://localhost:4000";

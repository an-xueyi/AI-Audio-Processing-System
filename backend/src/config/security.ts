/*
 * Central security settings used by both HTTP and WebSocket requests.
 * Keeping the origin and cookie rules here prevents different routes from
 * accidentally applying different definitions of an allowed browser.
 */
const defaultFrontendOrigin = "http://localhost:5173";

// A Set is used because `has()` clearly expresses an exact membership check.
// Several origins may be supplied as one comma-separated environment variable.
export const allowedOrigins = new Set(
  // Use the configured list when present; otherwise allow the local Vite server.
  (process.env.CORS_ALLOWED_ORIGINS || defaultFrontendOrigin)
    // Turn one comma-separated string into an array of origin strings.
    .split(",")
    // Remove accidental spaces surrounding each configured URL.
    .map((origin) => origin.trim())
    // Remove empty entries, such as a trailing comma.
    .filter(Boolean),
);

export function isAllowedOrigin(origin: string | undefined): boolean {
  // Non-browser clients such as curl normally omit Origin. Browser requests
  // include it and must exactly match one configured frontend origin.
  return origin === undefined || allowedOrigins.has(origin);
}

// Secure cookies are sent only over HTTPS. Local HTTP development sets this to
// false; an HTTPS deployment should set COOKIE_SECURE=true.
export const sessionCookieSecure = process.env.COOKIE_SECURE === "true";

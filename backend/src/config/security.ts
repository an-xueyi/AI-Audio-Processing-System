const defaultFrontendOrigin = "http://localhost:5173";

export const allowedOrigins = new Set(
  (process.env.CORS_ALLOWED_ORIGINS || defaultFrontendOrigin)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

export function isAllowedOrigin(origin: string | undefined): boolean {
  return origin === undefined || allowedOrigins.has(origin);
}

export const sessionCookieSecure = process.env.COOKIE_SECURE === "true";


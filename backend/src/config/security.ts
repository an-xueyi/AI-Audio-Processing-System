/*
 * Central security settings used by both HTTP and WebSocket requests.
 * Keeping the origin and cookie rules here prevents different routes from
 * accidentally applying different definitions of an allowed browser.
 */
import {
  isLoopbackHostname,
  parseApplicationEnvironment,
  parseBooleanEnvironmentVariable,
  parseHttpUrl,
} from "./environment.js";

const defaultFrontendOrigin = "http://localhost:5173";

type SecurityConfiguration = {
  allowedOrigins: Set<string>;
  sessionCookieSecure: boolean;
};

/** Parse and validate browser-facing security settings as one policy. */
export function readSecurityConfiguration(
  environment: NodeJS.ProcessEnv,
): SecurityConfiguration {
  const applicationEnvironment = parseApplicationEnvironment(
    environment.APP_ENV,
  );
  const production = applicationEnvironment === "production";
  const configuredOrigins = environment.CORS_ALLOWED_ORIGINS?.trim();

  // Production must name its real browser origin explicitly. Falling back to
  // localhost would make a deployment appear healthy while rejecting its users.
  if (production && !configuredOrigins) {
    throw new Error("CORS_ALLOWED_ORIGINS is required in production");
  }

  const rawOrigins = configuredOrigins || defaultFrontendOrigin;
  const normalizedOrigins = rawOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      const parsedOrigin = parseHttpUrl("CORS_ALLOWED_ORIGINS", origin);

      // An Origin contains only scheme, hostname, and optional port. Rejecting a
      // path avoids configuration that can never match a browser Origin header.
      if (
        parsedOrigin.pathname !== "/" ||
        parsedOrigin.search ||
        parsedOrigin.hash ||
        parsedOrigin.username ||
        parsedOrigin.password
      ) {
        throw new Error(
          "Each CORS_ALLOWED_ORIGINS value must contain only an HTTP(S) origin",
        );
      }

      if (production && parsedOrigin.protocol !== "https:") {
        throw new Error("Production CORS_ALLOWED_ORIGINS must use HTTPS");
      }

      if (production && isLoopbackHostname(parsedOrigin.hostname)) {
        throw new Error("Production CORS_ALLOWED_ORIGINS cannot use localhost");
      }

      // URL.origin removes a harmless trailing slash and produces the exact form
      // sent by browsers in their Origin header.
      return parsedOrigin.origin;
    });

  if (normalizedOrigins.length === 0) {
    throw new Error("CORS_ALLOWED_ORIGINS must contain at least one origin");
  }

  const sessionCookieSecure = parseBooleanEnvironmentVariable(
    "COOKIE_SECURE",
    environment.COOKIE_SECURE,
    false,
  );

  // Authentication cookies sent over public HTTP can be intercepted. Refuse to
  // start instead of depending on an operator to notice the unsafe setting.
  if (production && !sessionCookieSecure) {
    throw new Error("COOKIE_SECURE must be true in production");
  }

  return {
    allowedOrigins: new Set(normalizedOrigins),
    sessionCookieSecure,
  };
}

const securityConfiguration = readSecurityConfiguration(process.env);

// A Set is used because `has()` clearly expresses an exact membership check.
export const allowedOrigins = securityConfiguration.allowedOrigins;

export function isAllowedOrigin(origin: string | undefined): boolean {
  // Non-browser clients such as curl normally omit Origin. Browser requests
  // include it and must exactly match one configured frontend origin.
  return origin === undefined || allowedOrigins.has(origin);
}

// Secure cookies are sent only over HTTPS. Local HTTP development sets this to
// false; an HTTPS deployment should set COOKIE_SECURE=true.
export const sessionCookieSecure = securityConfiguration.sessionCookieSecure;

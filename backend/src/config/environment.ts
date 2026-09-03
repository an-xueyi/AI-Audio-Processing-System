/*
 * Parse process-wide environment settings before network services start.
 *
 * Environment variables always arrive as strings. Central helpers prevent one
 * module from accepting a value that another module would interpret differently.
 */
import dotenv from "dotenv";

// Manual backend commands need backend/.env loaded before the constants at the
// bottom of this module are evaluated. Docker already supplies these variables,
// and dotenv does not overwrite values that are present in the process.
dotenv.config();

export type ApplicationEnvironment = "development" | "test" | "production";

/** Convert APP_ENV text into one of the three supported runtime modes. */
export function parseApplicationEnvironment(
  value: string | undefined,
): ApplicationEnvironment {
  // Missing APP_ENV keeps existing local commands convenient and predictable.
  const normalizedValue = value?.trim() || "development";

  if (
    normalizedValue !== "development" &&
    normalizedValue !== "test" &&
    normalizedValue !== "production"
  ) {
    throw new Error(
      "APP_ENV must be development, test, or production",
    );
  }

  return normalizedValue;
}

/** Read a required value and reject missing or whitespace-only text. */
export function requireEnvironmentVariable(
  name: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const value = environment[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

/** Parse an optional true/false variable without silently accepting a typo. */
export function parseBooleanEnvironmentVariable(
  name: string,
  value: string | undefined,
  fallback: boolean,
): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalizedValue = value.trim().toLowerCase();

  if (normalizedValue === "true") {
    return true;
  }

  if (normalizedValue === "false") {
    return false;
  }

  throw new Error(`${name} must be true or false`);
}

/** Require an absolute HTTP(S) URL and return its parsed representation. */
export function parseHttpUrl(name: string, value: string): URL {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTP or HTTPS URL`);
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(`${name} must use http or https`);
  }

  return parsedUrl;
}

/** Identify addresses that refer back to the machine running the browser. */
export function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

// Evaluate the application mode once so every backend module sees one value.
export const applicationEnvironment = parseApplicationEnvironment(
  process.env.APP_ENV,
);

export const isProductionEnvironment =
  applicationEnvironment === "production";

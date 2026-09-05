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

/** Validate a PostgreSQL URL and require encrypted transport in production. */
export function validateDatabaseUrl(
  name: string,
  value: string,
  environment: ApplicationEnvironment,
): URL {
  let parsedUrl: URL;

  try {
    // URL separates the protocol, hostname, credentials, and query parameters.
    // Parsing does not open a database connection or send the password anywhere.
    parsedUrl = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL connection URL`);
  }

  // PostgreSQL tools commonly accept either spelling in a connection string.
  if (
    parsedUrl.protocol !== "postgres:" &&
    parsedUrl.protocol !== "postgresql:"
  ) {
    throw new Error(`${name} must use postgres or postgresql`);
  }

  if (!parsedUrl.hostname) {
    throw new Error(`${name} must include a database hostname`);
  }

  if (environment === "production") {
    // sslmode is part of the URL query string, for example:
    // postgresql://user:password@host/database?sslmode=require
    const sslMode = parsedUrl.searchParams.get("sslmode")?.toLowerCase();
    const encryptedModes = new Set(["require", "verify-ca", "verify-full"]);

    // Refuse production startup when credentials and audio metadata would cross
    // the network without PostgreSQL TLS encryption.
    if (!sslMode || !encryptedModes.has(sslMode)) {
      throw new Error(
        `${name} must use sslmode=require, verify-ca, or verify-full in production`,
      );
    }
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

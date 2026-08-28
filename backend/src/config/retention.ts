/* Read and validate object-storage lifecycle settings from the environment. */
import dotenv from "dotenv";

// Manual commands read backend/.env; Docker already supplies these variables and
// dotenv deliberately does not replace values that are present in the process.
dotenv.config();

export function parsePositiveInteger(
  name: string,
  rawValue: string | undefined,
  fallback: number,
): number {
  // Environment variables are text. Use the documented fallback only when the
  // variable is absent; a present but invalid value should fail during startup.
  if (rawValue === undefined) {
    return fallback;
  }

  const parsedValue = Number(rawValue);

  // A positive safe integer prevents zero-length loops, negative retention, and
  // numbers too large for JavaScript to represent reliably.
  if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsedValue;
}

function readPositiveInteger(name: string, fallback: number): number {
  // Keep process.env access in this small wrapper so parsePositiveInteger can be
  // tested with explicit values without changing global environment variables.
  return parsePositiveInteger(name, process.env[name], fallback);
}

// New terminal jobs keep private audio for seven days unless deployment
// configuration deliberately chooses another whole-hour retention period.
export const resultRetentionHours = readPositiveInteger(
  "RESULT_RETENTION_HOURS",
  24 * 7,
);

// The cleanup process wakes once per minute by default.
export const cleanupIntervalSeconds = readPositiveInteger(
  "CLEANUP_INTERVAL_SECONDS",
  60,
);

// A bounded batch prevents one cleanup cycle from flooding PostgreSQL or MinIO.
export const cleanupBatchSize = readPositiveInteger("CLEANUP_BATCH_SIZE", 25);

// If a process crashes after claiming a row, another process may reclaim it
// after this timeout. S3 deletion is idempotent, so retrying is safe.
export const cleanupClaimTimeoutMinutes = readPositiveInteger(
  "CLEANUP_CLAIM_TIMEOUT_MINUTES",
  15,
);

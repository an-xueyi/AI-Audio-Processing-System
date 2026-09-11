/* Define how much unfinished processing work one owner may queue at once. */

// Two active jobs allow a person to queue another song while one is processing,
// but prevent one account or visitor session from filling the shared worker queue.
const defaultMaxActiveJobsPerOwner = 2;

export function parseMaxActiveJobsPerOwner(
  rawValue: string | undefined,
): number {
  // An absent environment variable uses the documented local default. A present
  // value is configuration chosen by an operator and must therefore be valid.
  if (rawValue === undefined) {
    return defaultMaxActiveJobsPerOwner;
  }

  // Environment variables are always text. Number converts values such as "4"
  // into a JavaScript number before the integer and range checks below.
  const parsedValue = Number(rawValue);

  // A safe positive integer excludes zero, negative values, decimals, NaN, and
  // numbers JavaScript cannot represent exactly.
  if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
    throw new Error("MAX_ACTIVE_JOBS_PER_OWNER must be a positive integer");
  }

  return parsedValue;
}

export const maxActiveJobsPerOwner = parseMaxActiveJobsPerOwner(
  process.env.MAX_ACTIVE_JOBS_PER_OWNER,
);

export function createActiveJobLimitMessage(): string {
  // Keep the API response identical whether the limit is detected before upload
  // or inside the authoritative job-creation transaction.
  const noun = maxActiveJobsPerOwner === 1 ? "job" : "jobs";
  return (
    `You already have ${maxActiveJobsPerOwner} active ${noun}. ` +
    "Wait for one to finish or cancel it before creating another job."
  );
}

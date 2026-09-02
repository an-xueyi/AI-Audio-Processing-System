/* Share account input rules so registration and settings cannot disagree. */
import { z } from "zod";

// Account names are identifiers rather than profile display names. Lower-case
// normalization makes login case-insensitive and matches the database constraint.
export const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must contain at least 3 characters")
  .max(30, "Username must contain at most 30 characters")
  .regex(
    /^[a-zA-Z0-9_]+$/,
    "Username may contain only letters, numbers, and underscores",
  )
  .transform((username) => username.toLowerCase());

// Do not trim passwords: leading or trailing spaces may be intentional secrets.
export const passwordSchema = z
  .string()
  .min(12, "Password must contain at least 12 characters")
  .max(128, "Password must contain at most 128 characters");

export const credentialsSchema = z
  .object({
    username: usernameSchema,
    password: passwordSchema,
  })
  .strict();

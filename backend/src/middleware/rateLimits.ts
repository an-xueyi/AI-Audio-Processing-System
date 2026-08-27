/*
 * Rate limits reduce accidental request floods and basic abuse. They protect
 * API work, but they are not authentication and do not replace a firewall.
 */
import { rateLimit } from "express-rate-limit";

export const apiRateLimit = rateLimit({
  // Count each client IP's requests inside a rolling 15-minute window.
  windowMs: 15 * 60 * 1000,
  // Allow at most 300 requests from one resolved client IP in that window.
  limit: 300,
  // Return modern standardized rate-limit information in response headers.
  standardHeaders: "draft-8",
  // Do not also send the older X-RateLimit-* header format.
  legacyHeaders: false,
  // express-rate-limit returns this JSON automatically when the limit is exceeded.
  message: {
    error: "Too many API requests. Please try again later.",
  },
});

export const uploadRateLimit = rateLimit({
  // Presigned upload requests receive a stricter hourly limit because each one
  // grants temporary permission to store a potentially large object.
  windowMs: 60 * 60 * 1000,
  // One client may request 30 temporary upload permissions per hour.
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: "Too many upload requests. Please try again later.",
  },
});

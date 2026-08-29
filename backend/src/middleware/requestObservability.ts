/* Assign request IDs, record status counters, and log completed HTTP requests. */
import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { logger } from "../observability/logger.js";
import { recordHttpResponse } from "../observability/metrics.js";
import { runWithRequestContext } from "../observability/requestContext.js";

const quietHealthPaths = new Set(["/health", "/ready"]);

export const observeRequest: RequestHandler = (req, res, next) => {
  // Generate IDs on the trusted server instead of accepting a caller-controlled
  // value that could forge another request's identity in logs.
  const requestId = randomUUID();
  const startedAt = process.hrtime.bigint();

  req.requestId = requestId;
  res.setHeader("X-Request-ID", requestId);

  runWithRequestContext({ requestId }, () => {
    // finish fires after Express has written status and body to the HTTP response.
    res.once("finish", () => {
      const durationMilliseconds =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000;

      recordHttpResponse(res.statusCode);

      // Successful health checks happen every few seconds and would hide useful
      // application events. Failures are still logged for diagnosis.
      if (!quietHealthPaths.has(req.path) || res.statusCode >= 500) {
        logger.info("http_request_completed", {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          durationMilliseconds: Number(durationMilliseconds.toFixed(2)),
        });
      }
    });

    next();
  });
};


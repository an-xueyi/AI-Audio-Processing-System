/*
 * Assemble and start the backend process.
 *
 * This file connects Express routes, security middleware, PostgreSQL, Kafka
 * background services, and WebSockets to one HTTP server. It also owns graceful
 * shutdown because every resource opened during startup must be closed here.
 */
import { createServer } from "http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { requireSession } from "./auth/session.js";
import { isAllowedOrigin } from "./config/security.js";
import { pool } from "./db.js";
import { requireAllowedOrigin } from "./middleware/origin.js";
import { apiRateLimit, uploadRateLimit } from "./middleware/rateLimits.js";
import { observeRequest } from "./middleware/requestObservability.js";
import { logger } from "./observability/logger.js";
import { getHttpMetricsSnapshot } from "./observability/metrics.js";
import jobsRouter from "./routes/jobs.js";
import sessionRouter from "./routes/session.js";
import uploadsRouter from "./routes/uploads.js";
import {
  startOutboxPublisher,
  stopOutboxPublisher,
} from "./kafka/outboxPublisher.js";
import { disconnectKafkaProducer } from "./kafka/producer.js";
import {
  startJobStatusConsumer,
  stopJobStatusConsumer,
} from "./kafka/jobStatusConsumer.js";
import { createJobUpdatesService } from "./websocket/jobUpdates.js";
import { getDurableOperationsSnapshot } from "./services/operationsService.js";
import type { ErrorRequestHandler, RequestHandler } from "express";

// Express stores the middleware and route pipeline in this application object.
const app = express();

// Remove a response header that would otherwise advertise Express to clients.
app.disable("x-powered-by");
/*
 * In Docker, every public request passes through exactly one reverse proxy:
 * Nginx. Trusting one proxy hop allows Express to read the browser address from
 * X-Forwarded-For instead of seeing Nginx as the sender of every request. This
 * matters to the rate limiter, which counts requests by client IP. The backend
 * is not published directly to the host, so browsers cannot bypass Nginx and
 * supply an untrusted forwarded address to the container.
 */
app.set("trust proxy", 1);

// Observability runs before security and route middleware so rejected requests,
// not-found responses, and unexpected errors all receive a correlation ID.
app.use(observeRequest);

// Helmet adds several defensive HTTP response headers with secure defaults.
app.use(helmet());

// CORS tells browsers which frontend origins may read cross-origin responses and
// whether they may include cookies. It does not affect server-to-server clients.
app.use(
  cors({
    origin(origin, callback) {
      // The callback's first argument would contain a CORS-processing error. null
      // means no error; the Boolean second argument allows or denies this origin.
      callback(null, isAllowedOrigin(origin));
    },
    // Allow the browser's signed session cookie on frontend-to-backend requests.
    credentials: true,
    // Preflight responses advertise only the HTTP methods used by this API.
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    // Frontend JavaScript may read the safe correlation ID from failed responses.
    exposedHeaders: ["X-Request-ID"],
  }),
);

// Parse JSON request bodies and place the result on req.body. The 32 KB limit is
// small because audio bytes upload directly to object storage, not this API.
app.use(express.json({ limit: "32kb" }));

// Express executes middleware in registration order. Every /api request first
// passes origin validation and the general rate limit.
app.use("/api", requireAllowedOrigin, apiRateLimit);

// Session creation is public because a new browser does not have a cookie yet.
app.use("/api/session", sessionRouter);

// Upload and job routes require a verified session. Upload permission has an
// additional stricter rate limit before its route handler executes.
app.use("/api/uploads", requireSession, uploadRateLimit, uploadsRouter);
app.use("/api/jobs", requireSession, jobsRouter);

// Node environment variables are strings. Keeping this value as string or
// number is valid because server.listen accepts both forms.
const PORT = process.env.PORT || 4000;
// Docker assigns a different HOSTNAME to each replica. Returning it from health
// endpoints makes load balancing visible during local testing without exposing
// secrets, source paths, or database information.
const instanceId = process.env.HOSTNAME || `local-${process.pid}`;

app.get("/health", (req, res) => {
  // Liveness answers without contacting dependencies. A successful response
  // proves only that this Node process can receive and handle an HTTP request.
  res.json({ status: "ok", service: "backend", instanceId });
});

app.get("/ready", async (req, res) => {
  try {
    // SELECT 1 is a tiny query used to prove that a PostgreSQL connection can be
    // acquired and the database can execute SQL.
    await pool.query("SELECT 1");

    // Readiness means this replica is suitable for Nginx to send traffic to.
    res.json({
      status: "ready",
      service: "backend",
      instanceId,
      database: "connected",
    });
  } catch (error) {
    // HTTP 503 means the process exists but is temporarily unable to serve normal
    // work because a required dependency is unavailable.
    res.status(503).json({
      status: "not ready",
      service: "backend",
      instanceId,
      database: "disconnected",
    });
  }
});

app.get("/db-health", async (req, res) => {
  try {
    // NOW() returns the database server's current time and demonstrates that the
    // response contains a real query result rather than a fixed health message.
    const result = await pool.query("SELECT NOW()");
    res.json({
      database: "connected",
      time: result.rows[0].now,
    });
  } catch (error) {
    res.status(500).json({
      database: "disconnected",
    });
  }
});

app.get("/internal/operations", async (req, res) => {
  /*
   * Nginx blocks /internal/ from public traffic. Operators can request this URL
   * only from the private Docker network, where it returns counts but no job
   * names, object keys, cookies, passwords, or error-message contents.
   */
  const durable = await getDurableOperationsSnapshot();

  res.json({
    status: "ok",
    service: "backend",
    instanceId,
    uptimeSeconds: Math.round(process.uptime()),
    process: getHttpMetricsSnapshot(),
    durable,
  });
});

const notFoundHandler: RequestHandler = (req, res) => {
  // This runs after every known route. Reaching it means no earlier route matched
  // the request's method and URL.
  res.status(404).json({
    error: "Route not found",
    path: req.originalUrl,
  });
};

const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  // Log the detailed server-side error for diagnosis, but return a generic
  // response so stack traces, credentials, and internal paths are not exposed.
  logger.error("http_request_failed", {
    error,
    method: req.method,
    path: req.path,
  });

  res.status(500).json({
    error: "Internal server error",
    // Users can report this value so an operator can find the matching log entry.
    requestId: req.requestId,
  });
};

// Error and not-found handlers must be registered last so normal routes get the
// first chance to handle a request.
app.use(notFoundHandler);
app.use(errorHandler);

// The raw Node HTTP server is needed because WebSockets perform an HTTP Upgrade
// on the same listening port used by Express.
const server = createServer(app);
const jobUpdatesService = createJobUpdatesService(server);

// Begin accepting HTTP connections. The callback runs once the port is bound.
server.listen(PORT, () => {
  logger.info("backend_started", { port: PORT });

  // Start the Kafka status consumer before the outbox polling loop. `void` marks
  // this Promise chain as intentionally started in the background.
  void startJobStatusConsumer(jobUpdatesService.notifyJobChanged)
    .then(() => {
      // Start publishing only after the consumer is ready to hear status events.
      startOutboxPublisher();
    })
    .catch((error) => {
      logger.error("kafka_background_start_failed", { error });
    });
});

// This guard prevents SIGTERM and SIGINT from running shutdown simultaneously.
let isShuttingDown = false;

async function shutdown(signal: string) {
  // A second signal finds shutdown already active and exits this function.
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info("backend_shutdown_requested", { signal });

  // Graceful cleanup should normally finish. This timer prevents a permanently
  // stuck dependency from leaving the container unable to terminate.
  const forceExitTimer = setTimeout(() => {
    logger.error("backend_shutdown_timed_out");
    process.exit(1);
  }, 30_000);

  // unref means this timer alone will not keep Node alive if everything else has
  // already closed successfully.
  forceExitTimer.unref();

  // Tell browsers to reconnect elsewhere before stopping the WebSocket server.
  jobUpdatesService.closeClients();

  try {
    // server.close uses a callback API. Wrapping it in a Promise allows it to be
    // awaited together with the Promise-based cleanup functions below.
    const httpServerClosed = new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          // reject marks this Promise as failed and transfers control to catch.
          reject(error);
          return;
        }

        // resolve marks the HTTP server cleanup as successfully complete.
        resolve();
      });
    });

    // These independent cleanup operations run concurrently. Promise.all waits
    // until every one succeeds, or rejects immediately when one fails.
    await Promise.all([
      jobUpdatesService.closeServer(),
      httpServerClosed,
      stopOutboxPublisher(),
      stopJobStatusConsumer(),
    ]);

    // The consumer/outbox loops are now stopped, so shared outbound resources can
    // be disconnected without new work trying to use them.
    await disconnectKafkaProducer();
    await pool.end();

    // Successful cleanup makes the emergency timer unnecessary.
    clearTimeout(forceExitTimer);
    logger.info("backend_shutdown_completed");
    process.exit(0);
  } catch (error) {
    logger.error("backend_shutdown_failed", { error });
    process.exit(1);
  }
}

process.on("SIGTERM", () => {
  // Docker sends SIGTERM when stopping or replacing this container.
  void shutdown("SIGTERM");
});

process.on("SIGINT", () => {
  // A local Ctrl+C sends SIGINT during manual backend development.
  void shutdown("SIGINT");
});

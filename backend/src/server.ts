import { createServer } from "http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { requireSession } from "./auth/session.js";
import { isAllowedOrigin } from "./config/security.js";
import { pool } from "./db.js";
import { requireAllowedOrigin } from "./middleware/origin.js";
import { apiRateLimit, uploadRateLimit } from "./middleware/rateLimits.js";
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
import type { ErrorRequestHandler, RequestHandler } from "express";

const app = express();

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
app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      callback(null, isAllowedOrigin(origin));
    },
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  }),
);
app.use(express.json({ limit: "32kb" }));
app.use("/api", requireAllowedOrigin, apiRateLimit);
app.use("/api/session", sessionRouter);
app.use("/api/uploads", requireSession, uploadRateLimit, uploadsRouter);
app.use("/api/jobs", requireSession, jobsRouter);

const PORT = process.env.PORT || 4000;
// Docker assigns a different HOSTNAME to each replica. Returning it from health
// endpoints makes load balancing visible during local testing without exposing
// secrets, source paths, or database information.
const instanceId = process.env.HOSTNAME || `local-${process.pid}`;

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "backend", instanceId });
});

app.get("/ready", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      status: "ready",
      service: "backend",
      instanceId,
      database: "connected",
    });
  } catch (error) {
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

const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: "Route not found",
    path: req.originalUrl,
  });
};

const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  console.error(error);

  res.status(500).json({
    error: "Internal server error",
  });
};

app.use(notFoundHandler);
app.use(errorHandler);

const server = createServer(app);
const jobUpdatesService = createJobUpdatesService(server);

server.listen(PORT, () => {
  console.log(`Backend API running on port ${PORT}`);

  void startJobStatusConsumer(jobUpdatesService.notifyJobChanged)
    .then(() => {
      startOutboxPublisher();
    })
    .catch((error) => {
      console.error("Failed to start Kafka background services:", error);
    });
});

let isShuttingDown = false;

async function shutdown(signal: string) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`Received ${signal}. Shutting down backend...`);

  const forceExitTimer = setTimeout(() => {
    console.error("Graceful shutdown timed out");
    process.exit(1);
  }, 30_000);

  forceExitTimer.unref();

  jobUpdatesService.closeClients();

  try {
    const httpServerClosed = new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    await Promise.all([
      jobUpdatesService.closeServer(),
      httpServerClosed,
      stopOutboxPublisher(),
      stopJobStatusConsumer(),
    ]);

    await disconnectKafkaProducer();
    await pool.end();

    clearTimeout(forceExitTimer);
    console.log("Backend shutdown completed");
    process.exit(0);
  } catch (error) {
    console.error("Backend shutdown failed:", error);
    process.exit(1);
  }
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

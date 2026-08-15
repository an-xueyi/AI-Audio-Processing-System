import { createServer } from "http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { WebSocket, WebSocketServer } from "ws";
import { readSessionId, requireSession } from "./auth/session.js";
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
import type { ErrorRequestHandler, RequestHandler } from "express";

const app = express();

app.disable("x-powered-by");
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
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "backend" });
});

app.get("/ready", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      status: "ready",
      service: "backend",
      database: "connected",
    });
  } catch (error) {
    res.status(503).json({
      status: "not ready",
      service: "backend",
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

const jobUpdatesWebSocketServer = new WebSocketServer({
  server,
  path: "/ws/jobs",
});

jobUpdatesWebSocketServer.on("connection", (socket, request) => {
  if (!isAllowedOrigin(request.headers.origin)) {
    socket.send(
      JSON.stringify({
        type: "error",
        error: "WebSocket origin is not allowed",
      }),
    );
    socket.close(1008, "Origin not allowed");
    return;
  }

  const sessionId = readSessionId(request.headers.cookie);

  if (!sessionId) {
    socket.send(
      JSON.stringify({
        type: "error",
        error: "A valid session is required",
      }),
    );
    socket.close(1008, "Authentication required");
    return;
  }

  const requestUrl = new URL(
    request.url || "",
    `http://${request.headers.host}`,
  );
  const jobId = requestUrl.searchParams.get("jobId");

  if (!jobId || !uuidPattern.test(jobId)) {
    socket.send(
      JSON.stringify({
        type: "error",
        error: "A valid jobId query parameter is required",
      }),
    );
    socket.close(1008, "Invalid job ID");
    return;
  }

  let previousPayload = "";

  const intervalId = setInterval(async () => {
    try {
      const result = await pool.query(
        `SELECT id, original_file_name, input_object_key, status, progress,
                result_object_keys, error_message, created_at, updated_at
         FROM jobs
         WHERE id = $1 AND owner_id = $2`,
        [jobId, sessionId],
      );

      if (result.rows.length === 0) {
        socket.send(
          JSON.stringify({
            type: "error",
            error: "Job not found",
          }),
        );
        socket.close();
        return;
      }

      const job = result.rows[0];

      const payload = JSON.stringify({
        type: "job_update",
        job,
      });

      if (payload !== previousPayload && socket.readyState === WebSocket.OPEN) {
        socket.send(payload);
        previousPayload = payload;
      }

      if (job.status === "COMPLETED" || job.status === "FAILED") {
        clearInterval(intervalId);
      }
    } catch (error) {
      socket.send(
        JSON.stringify({
          type: "error",
          error: "Failed to fetch job status",
        }),
      );
      socket.close();
    }
  }, 1000);

  socket.on("close", () => {
    clearInterval(intervalId);
  });
});

server.listen(PORT, () => {
  startOutboxPublisher();
  console.log(`Backend API running on port ${PORT}`);
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

  for (const socket of jobUpdatesWebSocketServer.clients) {
    socket.close(1001, "Server shutting down");
  }

  try {
    const websocketServerClosed = new Promise<void>((resolve) => {
      jobUpdatesWebSocketServer.close(() => resolve());
    });

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
      websocketServerClosed,
      httpServerClosed,
      stopOutboxPublisher(),
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

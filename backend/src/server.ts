import { createServer } from "http";
import express from "express";
import cors from "cors";
import { WebSocket, WebSocketServer } from "ws";
import { pool } from "./db.js";
import jobsRouter from "./routes/jobs.js";
import uploadsRouter from "./routes/uploads.js";
import { startOutboxPublisher } from "./kafka/outboxPublisher.js";
import type { ErrorRequestHandler, RequestHandler } from "express";

const app = express();

app.use(cors());
app.use(express.json());
app.use("/api/jobs", jobsRouter);
app.use("/api/uploads", uploadsRouter);

const PORT = process.env.PORT || 4000;

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "backend" });
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
  const requestUrl = new URL(
    request.url || "",
    `http://${request.headers.host}`,
  );
  const jobId = requestUrl.searchParams.get("jobId");

  if (!jobId) {
    socket.send(
      JSON.stringify({
        type: "error",
        error: "jobId query parameter is required",
      }),
    );
    socket.close();
    return;
  }

  let previousPayload = "";

  const intervalId = setInterval(async () => {
    try {
      const result = await pool.query("SELECT * FROM jobs WHERE id = $1", [
        jobId,
      ]);

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

server.listen(PORT, async () => {
  startOutboxPublisher();
  console.log(`Backend API running on port ${PORT}`);
});

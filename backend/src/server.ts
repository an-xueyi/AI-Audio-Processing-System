import express from "express";
import cors from "cors";
import { pool } from "./db.js";
import jobsRouter from "./routes/jobs.js";

const app = express();

app.use(cors());
app.use(express.json());
app.use("/api/jobs", jobsRouter);

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

app.listen(PORT, () => {
  console.log(`Backend API running on port ${PORT}`);
});

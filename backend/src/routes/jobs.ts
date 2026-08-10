import { Router } from "express";
import { pool } from "../db.js";
import { jobCreatedTopic } from "../kafka/producer.js";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { bucketName, s3Client } from "../storage/s3.js";

const router = Router();
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.post("/", async (req, res) => {
  const { originalFileName, inputObjectKey } = req.body;

  if (
    typeof originalFileName !== "string" ||
    originalFileName.trim().length === 0
  ) {
    return res.status(400).json({
      error: "originalFileName is required",
    });
  }

  if (
    typeof inputObjectKey !== "string" ||
    inputObjectKey.trim().length === 0
  ) {
    return res.status(400).json({
      error: "inputObjectKey is required",
    });
  }

  if (!inputObjectKey.startsWith("uploads/")) {
    return res.status(400).json({
      error: "inputObjectKey must start with uploads/",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `INSERT INTO jobs 
      (original_file_name, input_object_key, status, progress) 
      VALUES ($1, $2, $3, $4) 
      RETURNING *`,
      [originalFileName, inputObjectKey, "PENDING", 0],
    );

    const job = result.rows[0];

    const eventPayload = {
      jobId: job.id,
      inputObjectKey: job.input_object_key,
      originalFileName: job.original_file_name,
    };

    await client.query(
      `INSERT INTO outbox_events 
      (topic, event_key, payload) 
      VALUES ($1, $2, $3::jsonb)`,
      [jobCreatedTopic, job.id, JSON.stringify(eventPayload)],
    );

    await client.query("COMMIT");

    res.status(201).json(job);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

type ResultObjectKeys = Record<string, string>;

router.get("/:id/downloads", async (req, res) => {
  try {
    const { id } = req.params;

    if (!uuidPattern.test(id)) {
      return res.status(400).json({
        error: "Invalid job id",
      });
    }

    const result = await pool.query(
      `SELECT id, status, progress, result_object_keys 
      FROM jobs 
      WHERE id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Job not found" });
    }

    const job = result.rows[0];

    if (job.status !== "COMPLETED") {
      return res.status(409).json({
        error: "Job is not completed yet",
        status: job.status,
        progress: job.progress,
      });
    }
    const resultObjectKeys = job.result_object_keys as ResultObjectKeys | null;

    if (!resultObjectKeys) {
      return res
        .status(409)
        .json({ error: "Job is completed but has no result files" });
    }

    const downloadUrls: Record<string, string> = {};

    for (const [stemName, objectKey] of Object.entries(resultObjectKeys)) {
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
      });

      downloadUrls[stemName] = await getSignedUrl(s3Client, command, {
        expiresIn: 60 * 5,
      });
    }

    res.json({ jobId: job.id, downloadUrls, expiresInSeconds: 300 });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to generate download URLs" });
  }
});

router.get("/:id", async (req, res) => {
  const { id } = req.params;

  if (!uuidPattern.test(id)) {
    return res.status(400).json({
      error: "Invalid job id",
    });
  }

  const result = await pool.query(`SELECT * FROM jobs WHERE id = $1`, [id]);

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Job not found" });
  }

  res.json(result.rows[0]);
});

export default router;

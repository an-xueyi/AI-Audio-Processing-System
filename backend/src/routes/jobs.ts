import { Router } from "express";
import { pool } from "../db.js";
import { jobCreatedTopic } from "../kafka/producer.js";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";
import {
  allowedAudioContentTypes,
  maxUploadBytes,
} from "../config/upload.js";
import { bucketName, s3Client, s3PublicClient } from "../storage/s3.js";

const router = Router();
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const createJobSchema = z
  .object({
    originalFileName: z.string().trim().min(1).max(255),
    inputObjectKey: z.string().trim().min(1).max(1024),
  })
  .strict();

router.post("/", async (req, res) => {
  const parsedRequest = createJobSchema.safeParse(req.body);

  if (!parsedRequest.success) {
    return res.status(400).json({
      error: parsedRequest.error.issues[0]?.message || "Invalid job request",
    });
  }

  const { originalFileName, inputObjectKey } = parsedRequest.data;
  const requiredObjectPrefix = `uploads/${req.sessionId}/`;

  if (!inputObjectKey.startsWith(requiredObjectPrefix)) {
    return res.status(400).json({
      error: "The uploaded object does not belong to this session",
    });
  }

  try {
    const object = await s3Client.send(
      new HeadObjectCommand({
        Bucket: bucketName,
        Key: inputObjectKey,
      }),
    );

    if (object.Metadata?.["owner-id"] !== req.sessionId) {
      return res.status(400).json({
        error: "The uploaded object has invalid ownership metadata",
      });
    }

    if (
      !object.ContentType ||
      !allowedAudioContentTypes.has(object.ContentType) ||
      !object.ContentLength ||
      object.ContentLength > maxUploadBytes
    ) {
      return res.status(400).json({
        error: "The uploaded object does not satisfy the audio upload policy",
      });
    }
  } catch (error) {
    return res.status(400).json({
      error: "The uploaded audio object could not be verified",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `INSERT INTO jobs 
      (owner_id, original_file_name, input_object_key, status, progress)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, original_file_name, input_object_key, status, progress,
                result_object_keys, error_message, created_at, updated_at`,
      [req.sessionId, originalFileName, inputObjectKey, "PENDING", 0],
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
      WHERE id = $1 AND owner_id = $2`,
      [id, req.sessionId],
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

      downloadUrls[stemName] = await getSignedUrl(s3PublicClient, command, {
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

  const result = await pool.query(
    `SELECT id, original_file_name, input_object_key, status, progress,
            result_object_keys, error_message, created_at, updated_at
     FROM jobs
     WHERE id = $1 AND owner_id = $2`,
    [id, req.sessionId],
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Job not found" });
  }

  res.json(result.rows[0]);
});

export default router;

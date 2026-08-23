import { Router } from "express";
import { z } from "zod";
import {
  createResultDownloadUrls,
  UploadValidationError,
  verifyOwnedAudioUpload,
} from "../services/audioStorage.js";
import {
  cancelJob,
  createJob,
  findOwnedJob,
} from "../services/jobService.js";

const router = Router();
const uuidSchema = z.string().uuid();

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
    await verifyOwnedAudioUpload(req.sessionId, inputObjectKey);
  } catch (error) {
    if (error instanceof UploadValidationError) {
      return res.status(400).json({ error: error.message });
    }

    throw error;
  }

  const job = await createJob(
    req.sessionId,
    originalFileName,
    inputObjectKey,
  );
  res.status(201).json(job);
});

router.post("/:id/cancel", async (req, res) => {
  const parsedJobId = uuidSchema.safeParse(req.params.id);

  if (!parsedJobId.success) {
    return res.status(400).json({ error: "Invalid job id" });
  }

  const result = await cancelJob(parsedJobId.data, req.sessionId);

  if (result.outcome === "not_found") {
    return res.status(404).json({ error: "Job not found" });
  }

  if (result.outcome === "not_cancellable") {
    return res.status(409).json({
      error: `A ${result.status} job cannot be cancelled`,
    });
  }

  res.json(result.job);
});

router.get("/:id/downloads", async (req, res) => {
  const parsedJobId = uuidSchema.safeParse(req.params.id);

  if (!parsedJobId.success) {
    return res.status(400).json({ error: "Invalid job id" });
  }

  const job = await findOwnedJob(parsedJobId.data, req.sessionId);

  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  if (job.status !== "COMPLETED") {
    return res.status(409).json({
      error: "Job is not completed yet",
      status: job.status,
      progress: job.progress,
    });
  }

  if (!job.result_object_keys) {
    return res.status(409).json({
      error: "Job is completed but has no result files",
    });
  }

  const downloadUrls = await createResultDownloadUrls(job.result_object_keys);

  res.json({
    jobId: job.id,
    downloadUrls,
    expiresInSeconds: 60 * 5,
  });
});

router.get("/:id", async (req, res) => {
  const parsedJobId = uuidSchema.safeParse(req.params.id);

  if (!parsedJobId.success) {
    return res.status(400).json({ error: "Invalid job id" });
  }

  const job = await findOwnedJob(parsedJobId.data, req.sessionId);

  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  res.json(job);
});

export default router;

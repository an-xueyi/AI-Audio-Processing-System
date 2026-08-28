/* HTTP routes for creating, reading, cancelling, and downloading owned jobs. */
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
  findRecentOwnedJobs,
} from "../services/jobService.js";
import { hasStorageExpired } from "../services/storageLifecycle.js";

const router = Router();
// Reusing one UUID schema keeps every route's job-id validation consistent.
const uuidSchema = z.string().uuid();

const createJobSchema = z
  .object({
    originalFileName: z.string().trim().min(1).max(255),
    inputObjectKey: z.string().trim().min(1).max(1024),
  })
  // strict rejects extra keys instead of allowing undocumented request data.
  .strict();

router.post("/", async (req, res) => {
  // Validate untrusted network JSON before reading either expected property.
  const parsedRequest = createJobSchema.safeParse(req.body);

  if (!parsedRequest.success) {
    return res.status(400).json({
      error: parsedRequest.error.issues[0]?.message || "Invalid job request",
    });
  }

  const { originalFileName, inputObjectKey } = parsedRequest.data;
  const requiredObjectPrefix = `uploads/${req.sessionId}/`;

  // Do not trust an object key merely because the browser sent it. A session
  // may create jobs only from its own upload directory.
  if (!inputObjectKey.startsWith(requiredObjectPrefix)) {
    return res.status(400).json({
      error: "The uploaded object does not belong to this session",
    });
  }

  // The prefix check is followed by a storage metadata check. Together they
  // verify that the object exists, has the expected owner, type, and size.
  try {
    await verifyOwnedAudioUpload(req.sessionId, inputObjectKey);
  } catch (error) {
    if (error instanceof UploadValidationError) {
      return res.status(400).json({ error: error.message });
    }

    throw error;
  }

  // The service performs the database job and outbox writes transactionally.
  const job = await createJob(
    req.sessionId,
    originalFileName,
    inputObjectKey,
  );
  // 201 Created is the correct success status for a new job resource.
  res.status(201).json(job);
});

router.get("/", async (req, res) => {
  /*
   * This route is mounted after requireSession in server.ts. req.sessionId is
   * therefore a verified signed-cookie value, not an owner ID supplied by the
   * browser in a query string or request body.
   */
  const jobs = await findRecentOwnedJobs(req.sessionId);

  // Wrap the array in an object so the response can gain pagination metadata in
  // the future without changing the meaning of the existing `jobs` property.
  res.json({ jobs });
});

// :id is a route parameter. Express places its value in req.params.id.
router.post("/:id/cancel", async (req, res) => {
  const parsedJobId = uuidSchema.safeParse(req.params.id);

  if (!parsedJobId.success) {
    return res.status(400).json({ error: "Invalid job id" });
  }

  // Pass the verified session ID so cancellation cannot affect another owner.
  const result = await cancelJob(parsedJobId.data, req.sessionId);

  if (result.outcome === "not_found") {
    // The same response covers absent and differently owned jobs.
    return res.status(404).json({ error: "Job not found" });
  }

  if (result.outcome === "not_cancellable") {
    // HTTP 409 means the request conflicts with current state, for example when
    // a client tries to cancel a job that has already completed.
    return res.status(409).json({
      error: `A ${result.status} job cannot be cancelled`,
    });
  }

  // Successful cancellation returns the authoritative updated database record.
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
    // Clients must not receive result URLs while files may still be incomplete.
    return res.status(409).json({
      error: "Job is not completed yet",
      status: job.status,
      progress: job.progress,
    });
  }

  // Expiration is enforced when its time arrives, even if the asynchronous
  // cleanup service has not physically removed the MinIO objects yet.
  if (hasStorageExpired(job)) {
    // 410 Gone means the resource existed previously but is intentionally no
    // longer available. This is more precise than 404 for retained job history.
    return res.status(410).json({
      error: "These audio results have expired and are no longer available",
    });
  }

  if (!job.result_object_keys) {
    // This guards inconsistent data: completion should normally include keys.
    return res.status(409).json({
      error: "Job is completed but has no result files",
    });
  }

  // The database stores stable private object keys, not long-lived public URLs.
  // Fresh temporary download URLs are created only when the owner requests them.
  const downloadUrls = await createResultDownloadUrls(job.result_object_keys);

  res.json({
    jobId: job.id,
    downloadUrls,
    expiresInSeconds: 60 * 5,
  });
});

router.get("/:id", async (req, res) => {
  // This endpoint returns one current job snapshot for initial load and polling.
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

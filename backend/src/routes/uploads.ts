/*
 * Issue temporary permission for a browser to upload one audio object directly
 * to S3-compatible storage. The large file never passes through Express.
 */
import { randomUUID } from "crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Router } from "express";
import { z } from "zod";
import {
  allowedAudioContentTypes,
  hasAllowedAudioExtension,
  maxUploadBytes,
} from "../config/upload.js";
import { logger } from "../observability/logger.js";
import { s3PublicClient, bucketName } from "../storage/s3.js";

const router = Router();

// Zod checks values at runtime. TypeScript types disappear after compilation,
// so they cannot protect the server from invalid JSON sent over the network.
const presignRequestSchema = z
  .object({
    // trim removes surrounding spaces before length validation.
    fileName: z.string().trim().min(1).max(255),
    contentType: z.string().trim().min(1).max(100),
    // The size must be a positive whole number no larger than policy allows.
    fileSize: z.number().int().positive().max(maxUploadBytes),
  })
  .strict();

router.post("/presign", async (req, res) => {
  // safeParse returns a success/error result instead of throwing for expected
  // user input problems, allowing the route to return a clear HTTP 400 response.
  const parsedRequest = presignRequestSchema.safeParse(req.body);

  if (!parsedRequest.success) {
    return res.status(400).json({
      error: parsedRequest.error.issues[0]?.message || "Invalid upload request",
    });
  }

  // Destructure the validated, trimmed values rather than using raw req.body.
  const { fileName, contentType, fileSize } = parsedRequest.data;

  // Set.has performs an exact lookup against the shared server policy.
  if (!allowedAudioContentTypes.has(contentType)) {
    return res.status(400).json({
      error: "This audio content type is not supported",
    });
  }

  if (!hasAllowedAudioExtension(fileName)) {
    return res.status(400).json({
      error: "Supported file extensions are MP3, WAV, FLAC, M4A, AAC, and OGG",
    });
  }

  // Keep the recognizable file name while removing path separators and unusual
  // characters that should not become part of an object-storage key.
  const safeFileName = fileName
    .replaceAll("/", "-")
    .replaceAll("\\", "-")
    .replace(/[^a-zA-Z0-9._ -]/g, "-");
  // Session ownership creates a private prefix. randomUUID prevents two files
  // with the same name from overwriting one another.
  const objectKey = `uploads/${req.ownerId}/${randomUUID()}-${safeFileName}`;

  // PutObjectCommand describes the one upload operation that the signed URL is
  // allowed to perform. It does not upload any bytes from this backend.
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: objectKey,
    ContentLength: fileSize,
    ContentType: contentType,
    Metadata: {
      // The backend verifies this storage metadata before creating a job.
      "owner-id": req.ownerId,
    },
  });

  // The signature expires after five minutes. Anyone holding the URL can use
  // its permission until expiration, so it should not be logged or persisted.
  const uploadUrl = await getSignedUrl(s3PublicClient, command, {
    expiresIn: 60 * 5,
  });

  // Never log uploadUrl because it is temporary authorization. These fields are
  // enough to explain volume and policy behavior without exposing permission.
  logger.info("upload_permission_created", {
    contentType,
    fileSize,
  });

  // Return only upload permission and metadata needed by the browser's next step.
  res.json({
    uploadUrl,
    objectKey,
    bucket: bucketName,
    expiresInSeconds: 60 * 5,
    maxUploadBytes,
  });
});

export default router;

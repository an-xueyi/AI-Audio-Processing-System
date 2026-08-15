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
import { s3PublicClient, bucketName } from "../storage/s3.js";

const router = Router();

const presignRequestSchema = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    contentType: z.string().trim().min(1).max(100),
    fileSize: z.number().int().positive().max(maxUploadBytes),
  })
  .strict();

router.post("/presign", async (req, res) => {
  const parsedRequest = presignRequestSchema.safeParse(req.body);

  if (!parsedRequest.success) {
    return res.status(400).json({
      error: parsedRequest.error.issues[0]?.message || "Invalid upload request",
    });
  }

  const { fileName, contentType, fileSize } = parsedRequest.data;

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

  const safeFileName = fileName
    .replaceAll("/", "-")
    .replaceAll("\\", "-")
    .replace(/[^a-zA-Z0-9._ -]/g, "-");
  const objectKey = `uploads/${req.sessionId}/${randomUUID()}-${safeFileName}`;

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: objectKey,
    ContentLength: fileSize,
    ContentType: contentType,
    Metadata: {
      "owner-id": req.sessionId,
    },
  });

  const uploadUrl = await getSignedUrl(s3PublicClient, command, {
    expiresIn: 60 * 5,
  });

  res.json({
    uploadUrl,
    objectKey,
    bucket: bucketName,
    expiresInSeconds: 60 * 5,
    maxUploadBytes,
  });
});

export default router;

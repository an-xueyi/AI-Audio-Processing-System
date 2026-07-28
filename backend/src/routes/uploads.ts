import { randomUUID } from "crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Router } from "express";
import { s3Client, bucketName } from "../storage/s3.js";

const router = Router();

router.post("/presign", async (req, res) => {
  const { fileName, contentType } = req.body;
  if (typeof fileName !== "string" || fileName.trim().length === 0) {
    return res.status(400).json({
      error: "fileName is required",
    });
  }

  if (typeof contentType !== "string" || contentType.trim().length === 0) {
    return res.status(400).json({
      error: "contentType is required",
    });
  }

  if (!contentType.startsWith("audio/")) {
    return res.status(400).json({
      error: "Only audio uploads are allowed",
    });
  }

  const safeFileName = fileName
    .trim()
    .replaceAll("/", "-")
    .replaceAll("\\", "-");
  const objectKey = `uploads/${randomUUID()}-${safeFileName}`;

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: objectKey,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(s3Client, command, {
    expiresIn: 60 * 5,
  }); // URL valid for 5 minutes

  res.json({
    uploadUrl,
    objectKey,
    bucket: bucketName,
    expiresInSeconds: 60 * 5,
  });
});

export default router;

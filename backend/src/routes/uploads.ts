import { randomUUID } from "crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Router } from "express";
import { s3Client, bucketName } from "../storage/s3.js";

const router = Router();

router.post("/presign", async (req, res) => {
  const { fileName, contentType } = req.body;
  if (!fileName || !contentType) {
    return res.status(400).json({
      error: "fileName and contentType are required",
    });
  }

  const safeFileName = fileName.replaceAll("/", "-");
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

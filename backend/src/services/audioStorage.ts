import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  allowedAudioContentTypes,
  maxUploadBytes,
} from "../config/upload.js";
import { bucketName, s3Client, s3PublicClient } from "../storage/s3.js";

export class UploadValidationError extends Error {}

export async function verifyOwnedAudioUpload(
  sessionId: string,
  objectKey: string,
) {
  try {
    const object = await s3Client.send(
      new HeadObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
      }),
    );

    if (object.Metadata?.["owner-id"] !== sessionId) {
      throw new UploadValidationError(
        "The uploaded object has invalid ownership metadata",
      );
    }

    if (
      !object.ContentType ||
      !allowedAudioContentTypes.has(object.ContentType) ||
      !object.ContentLength ||
      object.ContentLength > maxUploadBytes
    ) {
      throw new UploadValidationError(
        "The uploaded object does not satisfy the audio upload policy",
      );
    }
  } catch (error) {
    if (error instanceof UploadValidationError) {
      throw error;
    }

    throw new UploadValidationError(
      "The uploaded audio object could not be verified",
    );
  }
}

export async function createResultDownloadUrls(
  resultObjectKeys: Record<string, string>,
) {
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

  return downloadUrls;
}

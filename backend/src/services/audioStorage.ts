/* Verify uploaded objects and generate temporary links to completed results. */
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  allowedAudioContentTypes,
  maxUploadBytes,
} from "../config/upload.js";
import { bucketName, s3Client, s3PublicClient } from "../storage/s3.js";

// This expected error class allows routes to distinguish invalid user uploads
// from unexpected programming or infrastructure errors.
export class UploadValidationError extends Error {}

export async function verifyOwnedAudioUpload(
  ownerId: string,
  objectKey: string,
) {
  try {
    // HEAD reads object metadata without downloading the potentially large audio
    // body. This keeps job creation fast and avoids backend bandwidth usage.
    const object = await s3Client.send(
      new HeadObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
      }),
    );

    if (object.Metadata?.["owner-id"] !== ownerId) {
      // Optional chaining handles an object with no Metadata map.
      throw new UploadValidationError(
        "The uploaded object has invalid ownership metadata",
      );
    }

    // Never rely only on the browser's original presign request. Rechecking the
    // stored object makes the actual uploaded type and byte length authoritative.
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

    // Convert SDK details such as bucket names and internal endpoints into one
    // safe client-facing error. The original error is not exposed to the user.
    throw new UploadValidationError(
      "The uploaded audio object could not be verified",
    );
  }
}

export async function createResultDownloadUrls(
  resultObjectKeys: Record<string, string>,
) {
  // Begin with an empty map and fill one temporary URL per stored stem key.
  const downloadUrls: Record<string, string> = {};

  for (const [stemName, objectKey] of Object.entries(resultObjectKeys)) {
    // Object.entries turns { vocals: "key", drums: "key" } into iterable
    // [name, key] pairs so each stem receives its own signed GET permission.
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
    });

    // Bracket notation uses the runtime stemName, such as vocals or piano, as a key.
    downloadUrls[stemName] = await getSignedUrl(s3PublicClient, command, {
      expiresIn: 60 * 5,
    });
  }

  return downloadUrls;
}

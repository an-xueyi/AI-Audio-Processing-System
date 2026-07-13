import { S3Client } from "@aws-sdk/client-s3";
import dotenv from "dotenv";

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const bucketName = requireEnv("S3_BUCKET");

export const s3Client = new S3Client({
  region: requireEnv("S3_REGION"),
  endpoint: requireEnv("S3_ENDPOINT"),
  credentials: {
    accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
  },
  forcePathStyle: true, // Required for MinIO
});

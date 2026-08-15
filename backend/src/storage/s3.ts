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

const region = requireEnv("S3_REGION");
const credentials = {
  accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
  secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
};
const internalEndpoint = requireEnv("S3_ENDPOINT");
const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT || internalEndpoint;

function createS3Client(endpoint: string) {
  return new S3Client({
    region,
    endpoint,
    credentials,
    forcePathStyle: true,
  });
}

export const s3Client = createS3Client(internalEndpoint);
export const s3PublicClient = createS3Client(publicEndpoint);

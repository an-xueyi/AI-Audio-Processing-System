/* Configure the two S3-compatible clients used inside and outside Docker. */
import { S3Client } from "@aws-sdk/client-s3";
import dotenv from "dotenv";

dotenv.config();

function requireEnv(name: string): string {
  // Bracket notation reads the environment variable whose name was passed in.
  const value = process.env[name];
  if (!value) {
    // Failing during startup is safer than creating a partly configured client.
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
// Containers use the Docker service name (for example http://minio:9000), but a
// browser on the Mac needs a host-reachable address such as localhost:9000.
const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT || internalEndpoint;

function createS3Client(endpoint: string) {
  return new S3Client({
    region,
    endpoint,
    credentials,
    // MinIO commonly addresses buckets as /bucket/key. AWS S3 can instead use
    // bucket-name.s3.amazonaws.com; forcePathStyle keeps local MinIO compatible.
    forcePathStyle: true,
  });
}

// Internal client: backend-to-MinIO commands such as HEAD object.
export const s3Client = createS3Client(internalEndpoint);
// Public client: signs URLs containing an address the user's browser can reach.
export const s3PublicClient = createS3Client(publicEndpoint);

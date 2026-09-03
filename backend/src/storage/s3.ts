/* Configure the two S3-compatible clients used inside and outside Docker. */
import { S3Client } from "@aws-sdk/client-s3";
import dotenv from "dotenv";
import {
  isLoopbackHostname,
  isProductionEnvironment,
  parseHttpUrl,
  requireEnvironmentVariable,
} from "../config/environment.js";

dotenv.config();

export const bucketName = requireEnvironmentVariable("S3_BUCKET");

const region = requireEnvironmentVariable("S3_REGION");
const credentials = {
  accessKeyId: requireEnvironmentVariable("S3_ACCESS_KEY_ID"),
  secretAccessKey: requireEnvironmentVariable("S3_SECRET_ACCESS_KEY"),
};
const internalEndpoint = requireEnvironmentVariable("S3_ENDPOINT");
parseHttpUrl("S3_ENDPOINT", internalEndpoint);
// Containers use the Docker service name (for example http://minio:9000), but a
// browser on the Mac needs a host-reachable address such as localhost:9000.
const configuredPublicEndpoint = process.env.S3_PUBLIC_ENDPOINT?.trim();

if (isProductionEnvironment && !configuredPublicEndpoint) {
  throw new Error("S3_PUBLIC_ENDPOINT is required in production");
}

const publicEndpoint = configuredPublicEndpoint || internalEndpoint;
const parsedPublicEndpoint = parseHttpUrl("S3_PUBLIC_ENDPOINT", publicEndpoint);

if (isProductionEnvironment && parsedPublicEndpoint.protocol !== "https:") {
  throw new Error("S3_PUBLIC_ENDPOINT must use HTTPS in production");
}

if (
  isProductionEnvironment &&
  isLoopbackHostname(parsedPublicEndpoint.hostname)
) {
  throw new Error("S3_PUBLIC_ENDPOINT cannot use localhost in production");
}

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

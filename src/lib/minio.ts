import { Client } from "minio";
import { Readable } from "stream";

export const minioClient = new Client({
  endPoint: process.env.MINIO_ENDPOINT ?? "localhost",
  port: Number(process.env.MINIO_PORT ?? 9000),
  useSSL: process.env.MINIO_USE_SSL === "true",
  accessKey: process.env.MINIO_ACCESS_KEY ?? "minioadmin",
  secretKey: process.env.MINIO_SECRET_KEY ?? "minioadmin123",
});

export const PUBLIC_BUCKET = process.env.MINIO_PUBLIC_BUCKET ?? "cuban-jobs-public";
export const PRIVATE_BUCKET = process.env.MINIO_PRIVATE_BUCKET ?? "cuban-jobs-private";

const MINIO_PUBLIC_URL =
  process.env.MINIO_PUBLIC_URL ??
  `http://localhost:${process.env.MINIO_PORT ?? 9000}`;

/**
 * Creates a bucket if it doesn't exist. If publicRead is true, sets an
 * anonymous-read bucket policy — only ever use this for non-sensitive assets.
 * Call once during server startup before accepting requests.
 */
export async function ensureBucket(bucket: string, publicRead: boolean): Promise<void> {
  const exists = await minioClient.bucketExists(bucket);
  if (!exists) {
    await minioClient.makeBucket(bucket);
    console.log(`✅ MinIO bucket '${bucket}' created`);
  }

  if (publicRead) {
    await minioClient.setBucketPolicy(
      bucket,
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { AWS: ["*"] },
            Action: ["s3:GetObject"],
            Resource: [`arn:aws:s3:::${bucket}/*`],
          },
        ],
      })
    );
  }
}

/** Call once at startup: sets up both buckets with correct policies. */
export async function ensureBuckets(): Promise<void> {
  await ensureBucket(PUBLIC_BUCKET, true);
  await ensureBucket(PRIVATE_BUCKET, false);
}

/**
 * Uploads a buffer to the PUBLIC bucket and returns its public URL.
 * Use only for avatars, logos — nothing sensitive.
 */
export async function uploadPublicFile(
  buffer: Buffer,
  objectName: string,
  mimeType: string
): Promise<string> {
  const stream = Readable.from(buffer);
  await minioClient.putObject(PUBLIC_BUCKET, objectName, stream, buffer.length, {
    "Content-Type": mimeType,
  });
  return `${MINIO_PUBLIC_URL}/${PUBLIC_BUCKET}/${objectName}`;
}

/**
 * Uploads a buffer to the PRIVATE bucket. No public URL is returned —
 * access only via getSignedUrl. Use for CVs and other sensitive files.
 */
export async function uploadPrivateFile(
  buffer: Buffer,
  objectName: string,
  mimeType: string
): Promise<void> {
  const stream = Readable.from(buffer);
  await minioClient.putObject(PRIVATE_BUCKET, objectName, stream, buffer.length, {
    "Content-Type": mimeType,
  });
}

/**
 * Generates a time-limited pre-signed GET URL for a private object.
 * Expires after the given number of seconds (default 1 hour).
 */
export async function getSignedUrl(
  objectName: string,
  expirySeconds = 3600
): Promise<string> {
  return minioClient.presignedGetObject(PRIVATE_BUCKET, objectName, expirySeconds);
}

/** Deletes an object from the public bucket. Safe to call if it doesn't exist. */
export async function deletePublicFile(objectName: string): Promise<void> {
  await minioClient.removeObject(PUBLIC_BUCKET, objectName);
}

/** Deletes an object from the private bucket. Safe to call if it doesn't exist. */
export async function deletePrivateFile(objectName: string): Promise<void> {
  await minioClient.removeObject(PRIVATE_BUCKET, objectName);
}

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export function mimeToExt(mimeType: string): string {
  return MIME_TO_EXT[mimeType] ?? "bin";
}
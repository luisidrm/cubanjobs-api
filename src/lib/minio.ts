import { Client } from "minio";
import { Readable } from "stream";

export const minioClient = new Client({
  endPoint: process.env.MINIO_ENDPOINT ?? "localhost",
  port: Number(process.env.MINIO_PORT ?? 9000),
  useSSL: process.env.MINIO_USE_SSL === "true",
  accessKey: process.env.MINIO_ACCESS_KEY ?? "minioadmin",
  secretKey: process.env.MINIO_SECRET_KEY ?? "minioadmin123",
});

export const MEDIA_BUCKET = process.env.MINIO_BUCKET ?? "cuban-jobs";

const MINIO_PUBLIC_URL =
  process.env.MINIO_PUBLIC_URL ??
  `http://localhost:${process.env.MINIO_PORT ?? 9000}`;

/**
 * Creates the media bucket if it does not already exist.
 * Call once during server startup before accepting requests.
 */
export async function ensureBucket(): Promise<void> {
  const exists = await minioClient.bucketExists(MEDIA_BUCKET);
  if (!exists) {
    await minioClient.makeBucket(MEDIA_BUCKET);
    console.log(`✅ MinIO bucket '${MEDIA_BUCKET}' created`);
  }
}

/**
 * Uploads a buffer to MinIO and returns the public URL of the stored object.
 *
 * @param buffer   - File contents
 * @param objectName - Full object path inside the bucket (e.g. "profiles/uuid/avatar.jpg")
 * @param mimeType - MIME type used to set the Content-Type metadata
 */
export async function uploadFile(
  buffer: Buffer,
  objectName: string,
  mimeType: string
): Promise<string> {
  const stream = Readable.from(buffer);
  await minioClient.putObject(MEDIA_BUCKET, objectName, stream, buffer.length, {
    "Content-Type": mimeType,
  });
  return `${MINIO_PUBLIC_URL}/${MEDIA_BUCKET}/${objectName}`;
}

/**
 * Generates a time-limited pre-signed GET URL for private objects (e.g. CVs).
 * The URL expires after the given number of seconds (default 1 hour).
 */
export async function getSignedUrl(
  objectName: string,
  expirySeconds = 3600
): Promise<string> {
  return minioClient.presignedGetObject(MEDIA_BUCKET, objectName, expirySeconds);
}

/** Deletes an object from the bucket. Safe to call if the object doesn't exist. */
export async function deleteFile(objectName: string): Promise<void> {
  await minioClient.removeObject(MEDIA_BUCKET, objectName);
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

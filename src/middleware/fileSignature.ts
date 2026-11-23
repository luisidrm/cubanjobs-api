import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/AppError";

type Matcher = (b: Buffer) => boolean;

const startsWith = (...bytes: number[]): Matcher => (b) => bytes.every((byte, i) => b[i] === byte);

// Leading bytes of each accepted format. multer's `mimetype` is whatever the client
// declared, so on its own it only stops honest mistakes.
const SIGNATURES: Record<string, Matcher> = {
  "image/jpeg": startsWith(0xff, 0xd8, 0xff),
  "image/png": startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
  // RIFF....WEBP
  "image/webp": (b) => startsWith(0x52, 0x49, 0x46, 0x46)(b) && b.subarray(8, 12).toString("ascii") === "WEBP",
  "application/pdf": (b) => b.subarray(0, 5).toString("ascii") === "%PDF-",
};

/** True when the bytes really are the type they claim to be. Unknown types are rejected. */
export function matchesSignature(buffer: Buffer, mimetype: string): boolean {
  const matches = SIGNATURES[mimetype];
  return !!matches && buffer.length > 12 && matches(buffer);
}

/** Run right after multer: rejects an uploaded file whose content doesn't match its declared type. */
export function verifyFileSignature(req: Request, _res: Response, next: NextFunction) {
  const file = req.file;
  if (file && !matchesSignature(file.buffer, file.mimetype)) {
    return next(new AppError(400, "The file content does not match its type"));
  }
  next();
}

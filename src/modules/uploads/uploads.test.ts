import express from "express";
import multer from "multer";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { verifyFileSignature } from "../../middleware/fileSignature";
import { errorHandler } from "../../middleware/errorhandler";

// The real routes sit behind auth; this mounts just the multer + signature steps they share.
const app = express();
app.post("/upload", multer({ storage: multer.memoryStorage() }).single("file"), verifyFileSignature, (_req, res) => {
  res.json({ ok: true });
});
app.use(errorHandler);

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

describe("upload content check", () => {
  it("accepts a real PNG", async () => {
    const res = await request(app).post("/upload").attach("file", png, { filename: "a.png", contentType: "image/png" });
    expect(res.status).toBe(200);
  });

  it("rejects a script renamed to .png", async () => {
    const res = await request(app)
      .post("/upload")
      .attach("file", Buffer.from("<script>alert(1)</script>".padEnd(40)), { filename: "a.png", contentType: "image/png" });
    expect(res.status).toBe(400);
  });
});

import express from "express";
import multer from "multer";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "../lib/AppError";
import { escapeHtml } from "../lib/emailTemplate";
import { errorHandler } from "./errorhandler";

function makeApp() {
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 } });
  app.use(express.json({ limit: "1kb" }));
  app.post("/json", (_req, res) => {
    res.json({ ok: true });
  });
  app.post("/upload", upload.single("file"), (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/app-error", () => {
    throw new AppError(418, "teapot", { code: "TEA" });
  });
  app.get("/empty-update", () => {
    throw new Error("No values to set");
  });
  app.get("/drizzle-unique", () => {
    // What Drizzle throws for a unique violation: the driver error is on .cause.
    throw Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("duplicate key"), { code: "23505" }) });
  });
  app.get("/raw-unique", () => {
    throw Object.assign(new Error("duplicate key"), { code: "23505" });
  });
  app.get("/boom", () => {
    throw new Error("secret internal detail");
  });
  app.use(errorHandler);
  return app;
}

describe("errorHandler", () => {
  const app = makeApp();

  it("answers 400 (not 500) for malformed JSON", async () => {
    const res = await request(app).post("/json").set("content-type", "application/json").send("{bad");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: "Malformed JSON body" });
  });

  it("answers 413 for an oversized JSON body", async () => {
    const res = await request(app).post("/json").set("content-type", "application/json").send(JSON.stringify({ a: "x".repeat(5000) }));
    expect(res.status).toBe(413);
  });

  it("answers 413 for an oversized upload", async () => {
    const res = await request(app).post("/upload").attach("file", Buffer.alloc(100, 1), "big.bin");
    expect(res.status).toBe(413);
    expect(res.body.message).toBe("The file is too large");
  });

  it("keeps AppError status, message and details", async () => {
    const res = await request(app).get("/app-error");
    expect(res.status).toBe(418);
    expect(res.body).toEqual({ success: false, message: "teapot", details: { code: "TEA" } });
  });

  it("maps an empty UPDATE (PATCH {}) to 400", async () => {
    const res = await request(app).get("/empty-update");
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Nothing to update");
  });

  it("maps unique violations to 409, also when Drizzle wraps them in .cause", async () => {
    expect((await request(app).get("/drizzle-unique")).status).toBe(409);
    expect((await request(app).get("/raw-unique")).status).toBe(409);
  });

  it("hides internal details on unexpected errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await request(app).get("/boom");
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("secret");
  });
});

describe("escapeHtml", () => {
  it("neutralises markup and quotes", () => {
    expect(escapeHtml(`<img src=x onerror="a('b')">&`)).toBe("&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
  });
});

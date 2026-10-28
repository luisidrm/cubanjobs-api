import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authLimiter } from "./rateLimit";

describe("rate limiting", () => {
  const original = process.env.NODE_ENV;
  // The limiters are skipped under NODE_ENV=test; switch it off for this file.
  beforeEach(() => {
    process.env.NODE_ENV = "production";
  });
  afterEach(() => {
    process.env.NODE_ENV = original;
  });

  it("answers 429 with a JSON body once the auth limit is exceeded", async () => {
    const app = express();
    app.post("/auth/signin", authLimiter, (_req, res) => {
      res.json({ ok: true });
    });

    let last = 200;
    for (let i = 0; i < 31; i++) {
      last = (await request(app).post("/auth/signin")).status;
    }
    expect(last).toBe(429);
    const res = await request(app).post("/auth/signin");
    expect(res.status).toBe(429);
    expect(res.body.success).toBe(false);
  });
});

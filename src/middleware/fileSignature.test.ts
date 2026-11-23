import { describe, expect, it } from "vitest";
import { checkEnv } from "../lib/checkEnv";
import { matchesSignature } from "./fileSignature";

const pad = (head: number[]) => Buffer.concat([Buffer.from(head), Buffer.alloc(32)]);

describe("matchesSignature", () => {
  it("accepts real JPEG, PNG, WebP and PDF headers", () => {
    expect(matchesSignature(pad([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg")).toBe(true);
    expect(matchesSignature(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png")).toBe(true);
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(8)]);
    expect(matchesSignature(webp, "image/webp")).toBe(true);
    expect(matchesSignature(Buffer.concat([Buffer.from("%PDF-1.7"), Buffer.alloc(16)]), "application/pdf")).toBe(true);
  });

  it("rejects content that does not match the declared type", () => {
    expect(matchesSignature(Buffer.from("<script>alert(1)</script>".padEnd(40)), "image/png")).toBe(false);
    expect(matchesSignature(pad([0xff, 0xd8, 0xff]), "image/png")).toBe(false);
    expect(matchesSignature(pad([0xff, 0xd8, 0xff]), "text/html")).toBe(false);
  });
});

describe("checkEnv", () => {
  const full = {
    NODE_ENV: "production",
    DATABASE_URL: "x",
    SUPERTOKENS_URL: "x",
    API_DOMAIN: "x",
    WEBSITE_DOMAIN: "x",
    MINIO_ENDPOINT: "x",
    MINIO_ACCESS_KEY: "x",
    MINIO_SECRET_KEY: "x",
    MINIO_PUBLIC_URL: "x",
    REDIS_URL: "x",
    RESEND_API_KEY: "x",
    EMAIL_FROM: "x",
  } as NodeJS.ProcessEnv;

  it("passes with every required variable set", () => {
    expect(() => checkEnv(full)).not.toThrow();
  });

  it("names what is missing in production", () => {
    expect(() => checkEnv({ ...full, REDIS_URL: " ", RESEND_API_KEY: undefined })).toThrow(/REDIS_URL, RESEND_API_KEY/);
  });

  it("does not block development", () => {
    expect(() => checkEnv({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it("requires Stripe keys only when Stripe is on", () => {
    expect(() => checkEnv({ ...full, STRIPE_ENABLED: "true" })).toThrow(/STRIPE_SECRET_KEY/);
  });
});

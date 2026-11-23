import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "./logger";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("logger", () => {
  it("writes one JSON object per line in production, without decoration", () => {
    vi.stubEnv("NODE_ENV", "production");
    const sink = vi.spyOn(console, "warn").mockImplementation(() => {});

    logger.warn("⚠️  Redis connection error", { code: "ECONNREFUSED" });

    const line = JSON.parse(sink.mock.calls[0]![0] as string);
    expect(line).toMatchObject({ level: "warn", msg: "Redis connection error", detail: [{ code: "ECONNREFUSED" }] });
    expect(typeof line.time).toBe("string");
  });

  it("serializes an Error with its stack and cause", () => {
    vi.stubEnv("NODE_ENV", "production");
    const sink = vi.spyOn(console, "error").mockImplementation(() => {});

    logger.error("Upload failed", new Error("boom", { cause: new Error("disk full") }));

    const line = JSON.parse(sink.mock.calls[0]![0] as string);
    expect(line.detail[0]).toMatchObject({ name: "Error", message: "boom", cause: { message: "disk full" } });
    expect(line.detail[0].stack).toContain("boom");
  });

  it("keeps the plain console format in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const sink = vi.spyOn(console, "log").mockImplementation(() => {});

    logger.info("✅ ready", 3000);

    expect(sink).toHaveBeenCalledWith("✅ ready", 3000);
  });
});

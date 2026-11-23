import Redis from "ioredis";
import { rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { logger } from "../lib/logger";

// Counters live in Redis when REDIS_URL is set, so every API instance shares
// them (with in-memory counters, N instances would allow N times the limit).
// Without REDIS_URL (local dev, tests) each process counts on its own. If Redis
// is down the limiters let requests through rather than taking the API down
// with them (passOnStoreError). Skipped under vitest so test suites aren't throttled.
const skip = () => process.env.NODE_ENV === "test" || process.env.RATE_LIMIT_DISABLED === "true";

let client: Redis | null = null;
let clientCreatedAt = 0;
// The store loads its Lua script while the app boots, before the connection is up.
const STARTUP_GRACE_MS = 3_000;
function redisClient(): Redis {
  if (!client) {
    clientCreatedAt = Date.now();
    client = new Redis(process.env.REDIS_URL as string, {
      maxRetriesPerRequest: 1,
      connectTimeout: 1500,
      retryStrategy: (times) => Math.min(times * 200, 2000),
    });
    let lastWarn = 0;
    client.on("error", (err: NodeJS.ErrnoException) => {
      // ioredis emits on every failed reconnect; one line a minute is enough.
      if (Date.now() - lastWarn < 60_000) return;
      lastWarn = Date.now();
      logger.warn("⚠️  Rate-limit Redis error (limits not enforced):", err.message || err.code);
    });
  }
  return client;
}

/**
 * Sends a command only when Redis is ready. Outside the startup window a down
 * Redis fails immediately, so requests are let through at once (passOnStoreError)
 * instead of each one waiting on reconnect attempts.
 */
function send(args: string[]): Promise<never> {
  const c = redisClient();
  const run = () => c.call(args[0] as string, ...args.slice(1)) as Promise<never>;
  if (c.status === "ready") return run();
  if (Date.now() - clientCreatedAt > STARTUP_GRACE_MS) return Promise.reject(new Error("Redis not ready"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Redis not ready")), STARTUP_GRACE_MS);
    c.once("ready", () => {
      clearTimeout(timer);
      run().then(resolve, reject);
    });
  });
}

function limiter(name: string, windowMs: number, limit: number, message: string) {
  const useRedis = Boolean(process.env.REDIS_URL) && process.env.NODE_ENV !== "test";
  return rateLimit({
    windowMs,
    limit,
    skip,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    passOnStoreError: true,
    ...(useRedis
      ? {
          store: new RedisStore({
            prefix: `rl:${name}:`,
            sendCommand: (...args: string[]) => send(args),
          }),
        }
      : {}),
    handler: (_req, res) => {
      res.status(429).json({ success: false, message });
    },
  });
}

const MINUTE = 60_000;

/** Whole API, per IP. A generous ceiling that only stops scripted abuse. */
export const apiLimiter = limiter("api", MINUTE, 300, "Too many requests, please slow down");

/** Sign-in / sign-up / password-reset (SuperTokens /auth/*): brute-force and email-bombing guard. */
export const authLimiter = limiter("auth", 15 * MINUTE, 30, "Too many attempts, try again in a few minutes");

/** Payment reports (also capped at 3 pending per user in the service). */
export const paymentLimiter = limiter("payment", 60 * MINUTE, 20, "Too many payment submissions, try again later");

/** Avatar / CV uploads. */
export const uploadLimiter = limiter("upload", 15 * MINUTE, 30, "Too many uploads, try again later");

/** Joining a company by code: stops guessing codes. */
export const joinLimiter = limiter("join", 15 * MINUTE, 10, "Too many attempts, try again later");

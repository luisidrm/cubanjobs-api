import { rateLimit } from "express-rate-limit";

// In-memory counters: correct for a single instance. If the API is scaled to
// several instances, move the store to Redis (rate-limit-redis) so the limits
// are shared. Skipped under vitest so test suites aren't throttled.
const skip = () => process.env.NODE_ENV === "test" || process.env.RATE_LIMIT_DISABLED === "true";

function limiter(windowMs: number, limit: number, message: string) {
  return rateLimit({
    windowMs,
    limit,
    skip,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ success: false, message });
    },
  });
}

const MINUTE = 60_000;

/** Whole API, per IP. A generous ceiling that only stops scripted abuse. */
export const apiLimiter = limiter(MINUTE, 300, "Too many requests, please slow down");

/** Sign-in / sign-up / password-reset (SuperTokens /auth/*): brute-force and email-bombing guard. */
export const authLimiter = limiter(15 * MINUTE, 30, "Too many attempts, try again in a few minutes");

/** Payment reports (also capped at 3 pending per user in the service). */
export const paymentLimiter = limiter(60 * MINUTE, 20, "Too many payment submissions, try again later");

/** Avatar / CV uploads. */
export const uploadLimiter = limiter(15 * MINUTE, 30, "Too many uploads, try again later");

/** Joining a company by code: stops guessing codes. */
export const joinLimiter = limiter(15 * MINUTE, 10, "Too many attempts, try again later");

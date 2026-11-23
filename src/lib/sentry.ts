import * as Sentry from "@sentry/node";

let enabled = false;

/**
 * Starts error reporting when SENTRY_DSN is set; without it everything here is a no-op,
 * so local development and tests never talk to Sentry.
 */
export function initSentry(env: NodeJS.ProcessEnv = process.env): boolean {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn || enabled) return enabled;

  Sentry.init({
    dsn,
    environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV || "development",
    // Errors are always sent; performance traces are sampled to stay inside the free quota.
    tracesSampleRate: Number(env.SENTRY_TRACES_SAMPLE_RATE ?? 0.05),
    // Never ship cookies, auth headers or request bodies (passwords, payment details).
    beforeSend(event) {
      if (event.request) {
        const { cookies: _cookies, headers: _headers, data: _data, ...safe } = event.request;
        event.request = safe;
      }
      return event;
    },
  });
  enabled = true;
  return true;
}

export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}

/** Waits for pending events to be sent before the process exits. */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (enabled) await Sentry.flush(timeoutMs);
}

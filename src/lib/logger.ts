import { captureException } from "./sentry";

type Level = "info" | "warn" | "error";

const isProduction = () => process.env.NODE_ENV === "production";

// Production lines are machine-read (one JSON object each), so the decorative
// emoji used in development is stripped from the message.
const stripDecoration = (text: string) => text.replace(/^[^\p{L}\p{N}]+/u, "");

function serialize(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      ...(value.cause ? { cause: serialize(value.cause) } : {}),
    };
  }
  return value;
}

function write(level: Level, message: unknown, rest: unknown[]) {
  const sink = level === "info" ? console.log : console[level];

  if (isProduction()) {
    const text = message instanceof Error ? message.message : String(message);
    sink(
      JSON.stringify({
        level,
        time: new Date().toISOString(),
        msg: stripDecoration(text),
        ...(message instanceof Error ? { error: serialize(message) } : {}),
        ...(rest.length > 0 ? { detail: rest.map(serialize) } : {}),
      }),
    );
  } else {
    sink(message, ...rest);
  }

  // Every logged error that carries a real Error goes to Sentry (a no-op when it is off).
  if (level === "error") {
    const err = [message, ...rest].find((v): v is Error => v instanceof Error);
    if (err) captureException(err);
  }
}

/** `logger.error("what failed", err)`. Same call shape as console, structured output in production. */
export const logger = {
  info: (message: unknown, ...rest: unknown[]) => write("info", message, rest),
  warn: (message: unknown, ...rest: unknown[]) => write("warn", message, rest),
  error: (message: unknown, ...rest: unknown[]) => write("error", message, rest),
};

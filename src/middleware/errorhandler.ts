import type { NextFunction, Request, Response } from "express";
import { MulterError } from "multer";
import { AppError } from "../lib/AppError";
import { logger } from "../lib/logger";

/** Shape of errors thrown by the `pg` driver for SQL-level failures. */
interface PgError extends Error {
  code?: string;
  constraint?: string;
  detail?: string;
}

// Drizzle wraps driver errors (DrizzleQueryError): the Postgres error, with its
// SQLSTATE code, is on .cause. Look at both so unique violations raised through
// Drizzle map to a 409 instead of falling through to a 500.
function pgErrorOf(err: unknown): PgError | null {
  if (typeof err !== "object" || err === null) return null;
  if ("code" in err && typeof (err as PgError).code === "string") return err as PgError;
  const cause = (err as { cause?: unknown }).cause;
  if (typeof cause === "object" && cause !== null && "code" in cause) return cause as PgError;
  return null;
}

/**
 * Centralized error handler. Must be the LAST middleware registered in
 * app.ts (after all routes). Express 5 forwards thrown/rejected errors
 * from async route handlers here automatically — no try/catch or
 * asyncHandler wrapper needed in controllers.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  // Upload limits (file too large, too many files) are the client's doing, not a server fault.
  if (err instanceof MulterError) {
    const tooLarge = err.code === "LIMIT_FILE_SIZE";
    return res.status(tooLarge ? 413 : 400).json({
      success: false,
      message: tooLarge ? "The file is too large" : "Invalid upload",
    });
  }

  // Errors raised by Express itself for bad input (malformed JSON, body too large)
  // carry a 4xx status; answer with it instead of a misleading 500.
  if (typeof err === "object" && err !== null) {
    const { status, type } = err as { status?: unknown; type?: unknown };
    if (typeof status === "number" && status >= 400 && status < 500) {
      return res.status(status).json({
        success: false,
        message:
          type === "entity.parse.failed"
            ? "Malformed JSON body"
            : type === "entity.too.large"
              ? "Request body too large"
              : "Bad request",
      });
    }
  }

  // An UPDATE whose body had no recognised fields (e.g. PATCH {}): Drizzle refuses
  // to build the statement. That is a client mistake, not a server fault.
  if (err instanceof Error && err.message === "No values to set") {
    return res.status(400).json({ success: false, message: "Nothing to update" });
  }

  // Fallback safety net for raw Postgres errors that slipped past an
  // application-level check (e.g. a uniqueness race condition). Application
  // code should still check proactively where possible — this just stops
  // those cases from leaking a raw 500 with a SQL error message.
  const pg = pgErrorOf(err);
  if (pg?.code === "23505") {
    return res.status(409).json({
      success: false,
      message: "A record with this value already exists",
    });
  }

  logger.error(err);

  return res.status(500).json({
    success: false,
    message: "Internal server error",
  });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} not found`,
  });
}
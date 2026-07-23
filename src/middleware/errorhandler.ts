import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/AppError";

/** Shape of errors thrown by the `pg` driver for SQL-level failures. */
interface PgError extends Error {
  code?: string;
  constraint?: string;
  detail?: string;
}

const isPgError = (err: unknown): err is PgError =>
  typeof err === "object" && err !== null && "code" in err;

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

  // Fallback safety net for raw Postgres errors that slipped past an
  // application-level check (e.g. a uniqueness race condition). Application
  // code should still check proactively where possible — this just stops
  // those cases from leaking a raw 500 with a SQL error message.
  if (isPgError(err) && err.code === "23505") {
    return res.status(409).json({
      success: false,
      message: "A record with this value already exists",
    });
  }

  console.error(err);

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
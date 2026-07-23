import type { NextFunction, Request, Response } from "express";
import type { z, ZodType } from "zod";
import { AppError } from "../lib/AppError";

/**
 * Validates req.body against the given Zod schema and replaces req.body
 * with the parsed (and thus typed + coerced) result. Throws a 400 AppError
 * with the Zod issue list on failure.
 */
export function validateBody(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      throw new AppError(400, "Invalid request body", result.error.issues);
    }
    req.body = result.data;
    next();
  };
}

export function validateParams<T extends z.ZodType>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      throw new AppError(400, "Invalid request parameters", result.error.issues);
    }
    // Stash the typed, parsed result separately from req.params rather than
    // overwriting it — req.params stays Express's native ParamsDictionary
    // (string | string[]) shape, and getValidatedParams<T>(req) below
    // retrieves the narrow type validateParams actually produced.
    (req as Request & { validatedParams?: unknown }).validatedParams = result.data;
    next();
  };
}

/**
 * Retrieves the params object produced by validateParams(schema) for this
 * request. Only call this in a route handler that has validateParams(...)
 * registered earlier in its middleware chain — there's no runtime check
 * tying T to what was actually validated, so a mismatched type here is a
 * silent bug, not a caught one.
 */
export function getValidatedParams<T>(req: Request): T {
  return (req as Request & { validatedParams?: T }).validatedParams as T;
}

export function validateQuery(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      throw new AppError(400, "Invalid query parameters", result.error.issues);
    }
    // req.query is technically read-only in types but assignable at runtime
    req.query = result.data as typeof req.query;
    next();
  };
}
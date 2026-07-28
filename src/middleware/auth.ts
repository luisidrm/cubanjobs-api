import type { NextFunction, Request, Response } from "express";
import { verifySession } from "supertokens-node/recipe/session/framework/express";
import type { SessionRequest } from "supertokens-node/framework/express";
import { getUserBySupertokensId } from "../modules/users/users.queries";
import { AppError } from "../lib/AppError";
import type { UserRole } from "../../db/schema/users";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string; role: UserRole };
    }
  }
}

/**
 * Verifies the SuperTokens session, loads the user profile from our DB,
 * and sets req.user with id, email, and role. Must run before requireRole.
 *
 * NOTE: session-verification errors (missing/expired/invalid) are forwarded
 * via next(err). These are SuperTokens error types and are only converted
 * into proper HTTP responses if `errorHandler()` from
 * "supertokens-node/framework/express" is registered in app.ts AFTER all
 * routes. Confirm that's in place — otherwise these errors fall through to
 * a generic 500 or crash the process.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  verifySession()(req as SessionRequest, res, async (err?: Error) => {
    if (err) return next(err);

    // biome-ignore lint/style/noNonNullAssertion: <explanation>
    const stId = (req as SessionRequest).session!.getUserId();

    try {
      const user = await getUserBySupertokensId(stId);
      req.user = { id: user.id, email: user.email, role: user.role };
      next();
    } catch (e) {
      // Covers the orphaned-user edge case: a valid session exists but no
      // matching row in our `users` table (e.g. a failed/rolled-back signup,
      // or manual DB tampering). getUserBySupertokensId should throw an
      // AppError(404, ...) in that case, which the global error handler
      // turns into a clean response rather than a raw 500.
      next(e);
    }
  });
}

/**
 * Guards a route to one or more roles. Must be placed after requireAuth in
 * the middleware chain since it reads req.user, which requireAuth populates.
 *
 * Usage:
 *   requireRole("employer")                // single role
 *   requireRole("employer", "admin")        // any of several roles
 */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new AppError(401, "Not authenticated");
    if (!roles.includes(req.user.role)) {
      throw new AppError(
        403,
        roles.length === 1
          ? `This action requires the '${roles[0]}' role`
          : `This action requires one of the following roles: ${roles.join(", ")}`
      );
    }
    next();
  };
}
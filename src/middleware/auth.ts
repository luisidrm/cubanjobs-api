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
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  verifySession()(req as SessionRequest, res, async (err?: Error) => {
    if (err) return next(err);
    const stId = (req as SessionRequest).session!.getUserId();
    try {
      const user = await getUserBySupertokensId(stId);
      req.user = { id: user.id, email: user.email, role: user.role };
      next();
    } catch (e) {
      next(e);
    }
  });
}

/**
 * Guards a route to a specific role. Must be placed after requireAuth in the
 * middleware chain since it reads req.user which requireAuth populates.
 */
export function requireRole(role: UserRole) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new AppError(401, "Not authenticated");
    if (req.user.role !== role) {
      throw new AppError(403, `This action requires the '${role}' role`);
    }
    next();
  };
}

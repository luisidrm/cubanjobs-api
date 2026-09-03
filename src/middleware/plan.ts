import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/AppError";
import { hasCandidateSearchAccess } from "../lib/plans";
import { getCompaniesByOwner } from "../modules/companies/companies.queries";

/**
 * Guards a route to employers with a Basic/Pro company plan. Must run after
 * requireAuth + requireRole("employer") — reads req.user, which requireAuth
 * populates. Enforced here (not just hidden in the mobile UI) since a
 * free-tier employer could otherwise hit the endpoint directly.
 */
export async function requireSearchAccess(req: Request, _res: Response, next: NextFunction) {
  try {
    const companies = await getCompaniesByOwner(req.user!.id);
    const allowed = companies.some((c) => hasCandidateSearchAccess(c.planTier));
    if (!allowed) {
      throw new AppError(403, "Candidate search requires a Basic or Pro plan. Upgrade to unlock.");
    }
    next();
  } catch (e) {
    next(e);
  }
}

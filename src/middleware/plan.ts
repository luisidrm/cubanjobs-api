import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/AppError";
import { hasCandidateSearchAccess } from "../lib/plans";
import { getCompaniesByOwner } from "../modules/companies/companies.queries";
import { hasActiveEmployeePlan } from "../modules/subscriptions/subscriptions.service";

/**
 * Guards a route to employers with a Basic/Pro company plan. Must run after
 * requireAuth + requireRole("employer") — reads req.user, which requireAuth
 * populates. Enforced here (not just hidden in the mobile UI) since a
 * free-tier employer could otherwise hit the endpoint directly.
 */
export async function requireSearchAccess(req: Request, _res: Response, next: NextFunction) {
  try {
    const companies = await getCompaniesByOwner(req.user!.id);
    const checks = await Promise.all(companies.map((c) => hasCandidateSearchAccess(c.planTier)));
    const allowed = checks.some(Boolean);
    if (!allowed) {
      throw new AppError(403, "Candidate search requires a Basic or Pro plan. Upgrade to unlock.");
    }
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * Guards a route to employees on an active paid plan (applying to jobs).
 * Answers 402 with a machine-readable code so the app can open the pay screen
 * instead of showing a generic error. Place after requireAuth.
 */
export async function requirePaidEmployee(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!(await hasActiveEmployeePlan(req.user!.id))) {
      throw new AppError(402, "An active plan is required to apply to jobs", { code: "PLAN_REQUIRED" });
    }
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * Guards the freelancer board's browsing side: paying employees, members of a
 * paid company (Basic/Pro), and admins. Everyone else gets a 402 with a code
 * the clients turn into an upgrade prompt.
 */
export async function requireFreelancerAccess(req: Request, _res: Response, next: NextFunction) {
  try {
    const user = req.user!;
    let allowed = user.role === "admin";
    if (!allowed && user.role === "employee") allowed = await hasActiveEmployeePlan(user.id);
    if (!allowed && user.role === "employer") {
      allowed = (await getCompaniesByOwner(user.id)).some((c) => c.planTier !== "free");
    }
    if (!allowed) {
      throw new AppError(402, "The freelancer board requires an active paid plan", { code: "PLAN_REQUIRED" });
    }
    next();
  } catch (e) {
    next(e);
  }
}

/** Same entitlement as applying to jobs, with a message that fits posting on the freelancer board. */
export async function requirePaidPoster(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!(await hasActiveEmployeePlan(req.user!.id))) {
      throw new AppError(402, "An active plan is required to post on the freelancer board", { code: "PLAN_REQUIRED" });
    }
    next();
  } catch (e) {
    next(e);
  }
}

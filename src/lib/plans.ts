import type { CompanyPlan } from "../../db/schema/companies";

/** Max active job posts per plan tier. `null` means unlimited. */
const PLAN_JOB_LIMITS: Record<CompanyPlan, number | null> = {
  free: 2,
  basic: 10,
  pro: null,
};

export function getPlanJobLimit(planTier: CompanyPlan): number | null {
  return PLAN_JOB_LIMITS[planTier];
}

export function hasCandidateSearchAccess(planTier: CompanyPlan): boolean {
  return planTier !== "free";
}

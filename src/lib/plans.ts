import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { plans } from "../../db";
import type { CompanyPlan } from "../../db/schema/companies";

/**
 * Plan limits come from the `plans` table so an admin can change them without
 * a deploy. The free tier has no row (nothing to sell), and the constants below
 * are also the fallback if a paid row is ever missing.
 */
const FALLBACK: Record<CompanyPlan, { jobLimit: number | null; candidateSearch: boolean; seatLimit: number | null }> = {
  free: { jobLimit: 2, candidateSearch: false, seatLimit: 1 },
  basic: { jobLimit: 10, candidateSearch: true, seatLimit: 3 },
  pro: { jobLimit: null, candidateSearch: true, seatLimit: null },
};

async function getPlanRow(code: string) {
  const [row] = await db.select().from(plans).where(eq(plans.code, code));
  return row;
}

/** Max active job posts for a company tier. `null` means unlimited. */
export async function getPlanJobLimit(planTier: CompanyPlan): Promise<number | null> {
  if (planTier === "free") return FALLBACK.free.jobLimit;
  const row = await getPlanRow(planTier);
  return row ? row.jobLimit : FALLBACK[planTier].jobLimit;
}

export async function hasCandidateSearchAccess(planTier: CompanyPlan): Promise<boolean> {
  if (planTier === "free") return false;
  const row = await getPlanRow(planTier);
  return row ? row.candidateSearch : FALLBACK[planTier].candidateSearch;
}

/** Max teammates (owner included) for a company tier. `null` means unlimited. */
export async function getPlanSeatLimit(planTier: CompanyPlan): Promise<number | null> {
  if (planTier === "free") return FALLBACK.free.seatLimit;
  const row = await getPlanRow(planTier);
  return row ? row.seatLimit : FALLBACK[planTier].seatLimit;
}

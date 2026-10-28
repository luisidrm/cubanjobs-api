import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../../../db/client";
import { paymentSettings, planPrices, plans } from "../../../db";

export interface PlanWithPrices {
  id: string;
  code: string;
  audience: "employee" | "employer";
  name: string;
  jobLimit: number | null;
  candidateSearch: boolean;
  prices: { months: number; priceCup: number }[];
}

/** Active plans (optionally one audience) with their active per-duration prices. */
export async function getActivePlans(audience?: "employee" | "employer"): Promise<PlanWithPrices[]> {
  const rows = await db
    .select()
    .from(plans)
    .where(audience ? and(eq(plans.isActive, true), eq(plans.audience, audience)) : eq(plans.isActive, true))
    .orderBy(asc(plans.sortOrder));

  if (rows.length === 0) return [];

  const prices = await db
    .select()
    .from(planPrices)
    .where(
      and(
        inArray(
          planPrices.planId,
          rows.map((r) => r.id)
        ),
        eq(planPrices.isActive, true)
      )
    )
    .orderBy(asc(planPrices.months));

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    audience: r.audience,
    name: r.name,
    jobLimit: r.jobLimit,
    candidateSearch: r.candidateSearch,
    prices: prices.filter((p) => p.planId === r.id).map((p) => ({ months: p.months, priceCup: p.priceCup })),
  }));
}

export async function getSettings(keys: string[]): Promise<Record<string, string>> {
  const rows = await db.select().from(paymentSettings).where(inArray(paymentSettings.key, keys));
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

const DESTINATION_KEYS = [
  "destination_card",
  "destination_phone",
  "destination_holder",
  "instructions_es",
  "instructions_en",
];

/** Where the user should send the Transfermóvil transfer (shown on the pay screen). */
export async function getPaymentDestination() {
  const s = await getSettings(DESTINATION_KEYS);
  return {
    card: s.destination_card ?? "",
    phone: s.destination_phone ?? "",
    holder: s.destination_holder ?? "",
    instructionsEs: s.instructions_es ?? "",
    instructionsEn: s.instructions_en ?? "",
  };
}

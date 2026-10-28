import { and, asc, desc, eq, gt, ilike, inArray, isNotNull, lte, ne, or } from "drizzle-orm";
import { db } from "../../../db/client";
import {
  companies,
  paymentSettings,
  payments,
  planEvents,
  planPrices,
  plans,
  users,
  type PaymentStatus,
} from "../../../db";
import { AppError } from "../../lib/AppError";
import { getSignedUrl } from "../../lib/minio";

// ---------------------------------------------------------------------------
// Payments queue
// ---------------------------------------------------------------------------

export interface AdminPaymentRow {
  id: string;
  status: PaymentStatus;
  payerEmail: string;
  userId: string | null;
  companyId: string | null;
  companyName: string | null;
  planCode: string;
  planName: string;
  audience: "employee" | "employer";
  months: number;
  amountCup: number;
  transferNumber: string;
  hasScreenshot: boolean;
  rejectReason: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
}

const paymentColumns = {
  id: payments.id,
  status: payments.status,
  payerEmail: payments.payerEmail,
  userId: payments.userId,
  companyId: payments.companyId,
  companyName: companies.name,
  planCode: plans.code,
  planName: plans.name,
  audience: plans.audience,
  months: payments.months,
  amountCup: payments.amountCup,
  transferNumber: payments.transferNumber,
  screenshotKey: payments.screenshotKey,
  rejectReason: payments.rejectReason,
  createdAt: payments.createdAt,
  reviewedAt: payments.reviewedAt,
};

function toRow({ screenshotKey, ...r }: Awaited<ReturnType<typeof selectPayments>>[number]): AdminPaymentRow {
  return { ...r, hasScreenshot: !!screenshotKey };
}

function selectPayments() {
  return db
    .select(paymentColumns)
    .from(payments)
    .innerJoin(plans, eq(plans.id, payments.planId))
    .leftJoin(companies, eq(companies.id, payments.companyId));
}

/** Oldest first for the pending queue (first come, first checked); newest first for history. */
export async function listPayments(status: PaymentStatus | undefined, limit: number, offset: number) {
  const base = selectPayments();
  const filtered = status ? base.where(eq(payments.status, status)) : base;
  const rows = await filtered
    .orderBy(status === "pending" ? asc(payments.createdAt) : desc(payments.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map(toRow);
}

export async function countPendingPayments(): Promise<number> {
  const rows = await db.select({ id: payments.id }).from(payments).where(eq(payments.status, "pending"));
  return rows.length;
}

export interface AccountPlanState {
  kind: "user" | "company";
  id: string;
  label: string;
  plan: string;
  planExpiresAt: Date | null;
  planSource: string;
}

export async function getPaymentDetail(id: string) {
  const [row] = await selectPayments().where(eq(payments.id, id));
  if (!row) throw new AppError(404, "Payment not found");

  const [full] = await db.select({ screenshotKey: payments.screenshotKey }).from(payments).where(eq(payments.id, id));
  const screenshotUrl = full?.screenshotKey ? await getSignedUrl(full.screenshotKey, 600) : null;

  // What the account looks like right now, so the admin sees whether this is a
  // first purchase, an early renewal, or a card subscription that conflicts.
  let account: AccountPlanState | null = null;
  if (row.audience === "employee" && row.userId) {
    const [u] = await db.select().from(users).where(eq(users.id, row.userId));
    if (u) {
      account = { kind: "user", id: u.id, label: u.email, plan: u.plan, planExpiresAt: u.planExpiresAt, planSource: u.planSource };
    }
  } else if (row.companyId) {
    const [c] = await db.select().from(companies).where(eq(companies.id, row.companyId));
    if (c) {
      account = { kind: "company", id: c.id, label: c.name, plan: c.planTier, planExpiresAt: c.planExpiresAt, planSource: c.planSource };
    }
  }

  return { ...toRow(row), screenshotUrl, account };
}

// ---------------------------------------------------------------------------
// Accounts: search, expiring soon, history
// ---------------------------------------------------------------------------

export async function searchAccounts(q: string): Promise<AccountPlanState[]> {
  const like = `%${q}%`;
  const [userRows, companyRows] = await Promise.all([
    db
      .select()
      .from(users)
      .where(and(eq(users.role, "employee"), ilike(users.email, like)))
      .limit(15),
    db
      .select({ company: companies, ownerEmail: users.email })
      .from(companies)
      .leftJoin(users, eq(users.id, companies.ownerId))
      .where(or(ilike(companies.name, like), ilike(users.email, like)))
      .limit(15),
  ]);

  return [
    ...userRows.map<AccountPlanState>((u) => ({
      kind: "user",
      id: u.id,
      label: u.email,
      plan: u.plan,
      planExpiresAt: u.planExpiresAt,
      planSource: u.planSource,
    })),
    ...companyRows.map<AccountPlanState>(({ company: c, ownerEmail }) => ({
      kind: "company",
      id: c.id,
      label: ownerEmail ? `${c.name} · ${ownerEmail}` : c.name,
      plan: c.planTier,
      planExpiresAt: c.planExpiresAt,
      planSource: c.planSource,
    })),
  ];
}

/** Paid accounts whose plan ends within `days`, soonest first (the "who do I chase" list). */
export async function getExpiringAccounts(days: number, now = new Date()): Promise<AccountPlanState[]> {
  const end = new Date(now.getTime() + days * 86_400_000);
  const [userRows, companyRows] = await Promise.all([
    db
      .select()
      .from(users)
      .where(and(eq(users.plan, "paid"), isNotNull(users.planExpiresAt), gt(users.planExpiresAt, now), lte(users.planExpiresAt, end))),
    db
      .select({ company: companies, ownerEmail: users.email })
      .from(companies)
      .leftJoin(users, eq(users.id, companies.ownerId))
      .where(and(ne(companies.planTier, "free"), isNotNull(companies.planExpiresAt), gt(companies.planExpiresAt, now), lte(companies.planExpiresAt, end))),
  ]);

  return [
    ...userRows.map<AccountPlanState>((u) => ({
      kind: "user",
      id: u.id,
      label: u.email,
      plan: u.plan,
      planExpiresAt: u.planExpiresAt,
      planSource: u.planSource,
    })),
    ...companyRows.map<AccountPlanState>(({ company: c, ownerEmail }) => ({
      kind: "company",
      id: c.id,
      label: ownerEmail ? `${c.name} · ${ownerEmail}` : c.name,
      plan: c.planTier,
      planExpiresAt: c.planExpiresAt,
      planSource: c.planSource,
    })),
  ].sort((a, b) => (a.planExpiresAt?.getTime() ?? 0) - (b.planExpiresAt?.getTime() ?? 0));
}

export async function getPlanHistory(target: { userId: string } | { companyId: string }) {
  return db
    .select()
    .from(planEvents)
    .where("userId" in target ? eq(planEvents.userId, target.userId) : eq(planEvents.companyId, target.companyId))
    .orderBy(desc(planEvents.createdAt))
    .limit(50);
}

// ---------------------------------------------------------------------------
// Plans, prices, settings
// ---------------------------------------------------------------------------

/** Every plan (including switched-off ones) with every price row, for the editor. */
export async function getAllPlansForAdmin() {
  const planRows = await db.select().from(plans).orderBy(asc(plans.sortOrder));
  const priceRows = planRows.length
    ? await db
        .select()
        .from(planPrices)
        .where(inArray(planPrices.planId, planRows.map((p) => p.id)))
        .orderBy(asc(planPrices.months))
    : [];
  return planRows.map((p) => ({
    ...p,
    prices: priceRows.filter((r) => r.planId === p.id).map((r) => ({ months: r.months, priceCup: r.priceCup, isActive: r.isActive })),
  }));
}

export async function updatePlan(
  id: string,
  patch: Partial<{ name: string; jobLimit: number | null; candidateSearch: boolean; isActive: boolean }>
) {
  const [updated] = await db.update(plans).set(patch).where(eq(plans.id, id)).returning();
  if (!updated) throw new AppError(404, "Plan not found");
  return updated;
}

export async function upsertPlanPrice(planId: string, months: number, priceCup: number, isActive: boolean) {
  const [plan] = await db.select({ id: plans.id }).from(plans).where(eq(plans.id, planId));
  if (!plan) throw new AppError(404, "Plan not found");
  const [row] = await db
    .insert(planPrices)
    .values({ planId, months, priceCup, isActive })
    .onConflictDoUpdate({ target: [planPrices.planId, planPrices.months], set: { priceCup, isActive } })
    .returning();
  return row!;
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await db.select().from(paymentSettings);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function updateSettings(values: Record<string, string>): Promise<Record<string, string>> {
  await db.transaction(async (tx) => {
    for (const [key, value] of Object.entries(values)) {
      await tx
        .insert(paymentSettings)
        .values({ key, value })
        .onConflictDoUpdate({ target: paymentSettings.key, set: { value } });
    }
  });
  return getAllSettings();
}

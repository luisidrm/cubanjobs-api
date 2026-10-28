import { and, count, eq, gt, isNull, or, sql, sum } from "drizzle-orm";
import { db } from "../../../db/client";
import { companies, payments, plans, users } from "../../../db";

const DAY = 86_400_000;
const ACTIVE_DAYS = 30;

export interface AdminMetrics {
  generatedAt: string;
  users: {
    total: number;
    employees: number;
    employers: number;
    admins: number;
    newLast7Days: number;
    newLast30Days: number;
  };
  /**
   * Users seen on each client. Tracking began when it shipped, so "everSeen"
   * only covers people who have used the app since then.
   */
  platforms: {
    web: { everSeen: number; activeLast30Days: number };
    app: { everSeen: number; activeLast30Days: number };
    both: number;
    activeDays: number;
  };
  plans: {
    employees: { free: number; paid: number };
    companies: { free: number; basic: number; pro: number };
  };
  revenue: {
    currency: "CUP";
    totalCup: number;
    last30DaysCup: number;
    thisMonthCup: number;
    approvedCount: number;
    pendingCount: number;
    pendingCup: number;
    rejectedCount: number;
    byPlan: { code: string; name: string; audience: string; count: number; amountCup: number }[];
    /** Oldest first; always the last 6 calendar months, including empty ones. */
    byMonth: { month: string; amountCup: number; count: number }[];
  };
}

const num = (v: unknown) => Number(v ?? 0);

/** "2026-03" for the UTC month containing `d`. */
const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/**
 * Everything the admin overview shows, in a handful of aggregate queries.
 * Revenue is the sum of approved Transfermóvil payments, dated by the day an
 * admin approved them (that is when the money is confirmed). Stripe-managed
 * subscriptions are not in this table, so they are counted under plans but not
 * in revenue.
 */
export async function getAdminMetrics(now = new Date()): Promise<AdminMetrics> {
  const since7 = new Date(now.getTime() - 7 * DAY);
  const since30 = new Date(now.getTime() - 30 * DAY);
  const activeSince = new Date(now.getTime() - ACTIVE_DAYS * DAY);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const sixMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));

  const [
    [userRow],
    [platformRow],
    [employeePlanRow],
    companyRows,
    [approvedRow],
    [pendingRow],
    [rejectedRow],
    byPlanRows,
    byMonthRows,
  ] = await Promise.all([
    db
      .select({
        total: count(),
        employees: sql<number>`count(*) filter (where ${users.role} = 'employee')`,
        employers: sql<number>`count(*) filter (where ${users.role} = 'employer')`,
        admins: sql<number>`count(*) filter (where ${users.role} = 'admin')`,
        new7: sql<number>`count(*) filter (where ${users.createdAt} >= ${since7})`,
        new30: sql<number>`count(*) filter (where ${users.createdAt} >= ${since30})`,
      })
      .from(users),

    db
      .select({
        webEver: sql<number>`count(*) filter (where ${users.webLastSeenAt} is not null)`,
        webActive: sql<number>`count(*) filter (where ${users.webLastSeenAt} >= ${activeSince})`,
        appEver: sql<number>`count(*) filter (where ${users.appLastSeenAt} is not null)`,
        appActive: sql<number>`count(*) filter (where ${users.appLastSeenAt} >= ${activeSince})`,
        both: sql<number>`count(*) filter (where ${users.webLastSeenAt} is not null and ${users.appLastSeenAt} is not null)`,
      })
      .from(users),

    // Same rule the API uses to decide whether an employee plan is active.
    db
      .select({
        paid: sql<number>`count(*) filter (where ${users.role} = 'employee' and ${users.plan} = 'paid' and (${users.planExpiresAt} is null or ${users.planExpiresAt} > ${now}))`,
        free: sql<number>`count(*) filter (where ${users.role} = 'employee' and not (${users.plan} = 'paid' and (${users.planExpiresAt} is null or ${users.planExpiresAt} > ${now})))`,
      })
      .from(users),

    db.select({ tier: companies.planTier, n: count() }).from(companies).groupBy(companies.planTier),

    db
      .select({ n: count(), total: sum(payments.amountCup) })
      .from(payments)
      .where(eq(payments.status, "approved")),
    db
      .select({ n: count(), total: sum(payments.amountCup) })
      .from(payments)
      .where(eq(payments.status, "pending")),
    db.select({ n: count() }).from(payments).where(eq(payments.status, "rejected")),

    db
      .select({
        code: plans.code,
        name: plans.name,
        audience: plans.audience,
        n: count(),
        total: sum(payments.amountCup),
      })
      .from(payments)
      .innerJoin(plans, eq(plans.id, payments.planId))
      .where(eq(payments.status, "approved"))
      .groupBy(plans.code, plans.name, plans.audience, plans.sortOrder)
      .orderBy(plans.sortOrder),

    db
      .select({
        month: sql<string>`to_char(${payments.reviewedAt}, 'YYYY-MM')`,
        n: count(),
        total: sum(payments.amountCup),
      })
      .from(payments)
      .where(and(eq(payments.status, "approved"), sql`${payments.reviewedAt} >= ${sixMonthsAgo}`))
      .groupBy(sql`to_char(${payments.reviewedAt}, 'YYYY-MM')`),
  ]);

  // Money in the last 30 days / this month: a second small pass keeps the SQL above readable.
  const [windowRow] = await db
    .select({
      last30: sql<number>`coalesce(sum(${payments.amountCup}) filter (where ${payments.reviewedAt} >= ${since30}), 0)`,
      month: sql<number>`coalesce(sum(${payments.amountCup}) filter (where ${payments.reviewedAt} >= ${monthStart}), 0)`,
    })
    .from(payments)
    .where(eq(payments.status, "approved"));

  const tiers = Object.fromEntries(companyRows.map((r) => [r.tier, num(r.n)]));

  const monthTotals = new Map(byMonthRows.map((r) => [r.month, { amountCup: num(r.total), count: num(r.n) }]));
  const byMonth = Array.from({ length: 6 }, (_, i) => {
    const key = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + i, 1)));
    return { month: key, ...(monthTotals.get(key) ?? { amountCup: 0, count: 0 }) };
  });

  return {
    generatedAt: now.toISOString(),
    users: {
      total: num(userRow?.total),
      employees: num(userRow?.employees),
      employers: num(userRow?.employers),
      admins: num(userRow?.admins),
      newLast7Days: num(userRow?.new7),
      newLast30Days: num(userRow?.new30),
    },
    platforms: {
      web: { everSeen: num(platformRow?.webEver), activeLast30Days: num(platformRow?.webActive) },
      app: { everSeen: num(platformRow?.appEver), activeLast30Days: num(platformRow?.appActive) },
      both: num(platformRow?.both),
      activeDays: ACTIVE_DAYS,
    },
    plans: {
      employees: { free: num(employeePlanRow?.free), paid: num(employeePlanRow?.paid) },
      companies: { free: tiers.free ?? 0, basic: tiers.basic ?? 0, pro: tiers.pro ?? 0 },
    },
    revenue: {
      currency: "CUP",
      totalCup: num(approvedRow?.total),
      last30DaysCup: num(windowRow?.last30),
      thisMonthCup: num(windowRow?.month),
      approvedCount: num(approvedRow?.n),
      pendingCount: num(pendingRow?.n),
      pendingCup: num(pendingRow?.total),
      rejectedCount: num(rejectedRow?.n),
      byPlan: byPlanRows.map((r) => ({
        code: r.code,
        name: r.name,
        audience: r.audience,
        count: num(r.n),
        amountCup: num(r.total),
      })),
      byMonth,
    },
  };
}

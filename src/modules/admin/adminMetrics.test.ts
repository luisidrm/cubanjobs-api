import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../../db/client";
import { companies, payments, plans, users } from "../../../db";
import { getAdminMetrics, type AdminMetrics } from "./adminMetrics.queries";

// The database may already hold other rows, so every assertion is a before/after
// difference caused by this file's own fixtures.
const suffix = randomUUID().slice(0, 8);
const NOW = new Date();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const userIds: string[] = [];
const companyIds: string[] = [];
let before: AdminMetrics;
let after: AdminMetrics;
let employeePlanId: string;

async function makeUser(label: string, values: Partial<typeof users.$inferInsert> = {}) {
  const [u] = await db
    .insert(users)
    .values({ supertokensUserId: `st-${suffix}-${label}`, email: `${label}-${suffix}@example.com`, ...values })
    .returning();
  userIds.push(u!.id);
  return u!;
}

const diff = (a: number, b: number) => a - b;

beforeAll(async () => {
  const [plan] = await db.select().from(plans).where(eq(plans.code, "employee_paid"));
  employeePlanId = plan!.id;
  before = await getAdminMetrics(NOW);

  // Users: 3 employees (paid/active, paid/lapsed, free), 1 employer, 1 admin.
  const paid = await makeUser("paid", { role: "employee", plan: "paid", planExpiresAt: daysAgo(-10), webLastSeenAt: daysAgo(1), appLastSeenAt: daysAgo(2) });
  await makeUser("lapsed", { role: "employee", plan: "paid", planExpiresAt: daysAgo(1), webLastSeenAt: daysAgo(90) });
  await makeUser("free", { role: "employee", appLastSeenAt: daysAgo(3) });
  await makeUser("boss", { role: "employer" });
  await makeUser("root", { role: "admin" });

  const [basic, pro] = await db
    .insert(companies)
    .values([
      { name: `Basic ${suffix}`, planTier: "basic" },
      { name: `Pro ${suffix}`, planTier: "pro" },
    ])
    .returning();
  companyIds.push(basic!.id, pro!.id);

  // Payments: two approved (one today, one 40 days ago), one pending, one rejected.
  const base = { userId: paid.id, payerEmail: paid.email, planId: employeePlanId, months: 1 };
  await db.insert(payments).values([
    { ...base, amountCup: 1000, transferNumber: `A${suffix}`, transferNumberNormalized: `A${suffix}`.toUpperCase(), status: "approved", reviewedAt: NOW },
    { ...base, amountCup: 250, transferNumber: `B${suffix}`, transferNumberNormalized: `B${suffix}`.toUpperCase(), status: "approved", reviewedAt: daysAgo(40) },
    { ...base, amountCup: 400, transferNumber: `C${suffix}`, transferNumberNormalized: `C${suffix}`.toUpperCase(), status: "pending" },
    { ...base, amountCup: 999, transferNumber: `D${suffix}`, transferNumberNormalized: `D${suffix}`.toUpperCase(), status: "rejected", reviewedAt: NOW },
  ]);

  after = await getAdminMetrics(NOW);
});

afterAll(async () => {
  if (userIds.length) {
    await db.delete(payments).where(inArray(payments.userId, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
  }
  if (companyIds.length) await db.delete(companies).where(inArray(companies.id, companyIds));
});

describe("getAdminMetrics", () => {
  it("counts users by role and by signup window", () => {
    expect(diff(after.users.total, before.users.total)).toBe(5);
    expect(diff(after.users.employees, before.users.employees)).toBe(3);
    expect(diff(after.users.employers, before.users.employers)).toBe(1);
    expect(diff(after.users.admins, before.users.admins)).toBe(1);
    expect(diff(after.users.newLast7Days, before.users.newLast7Days)).toBe(5);
    expect(diff(after.users.newLast30Days, before.users.newLast30Days)).toBe(5);
  });

  it("counts people per platform, separating recent activity from ever seen", () => {
    // web: paid (1 day ago) + lapsed (90 days ago); app: paid + free; both: paid only.
    expect(diff(after.platforms.web.everSeen, before.platforms.web.everSeen)).toBe(2);
    expect(diff(after.platforms.web.activeLast30Days, before.platforms.web.activeLast30Days)).toBe(1);
    expect(diff(after.platforms.app.everSeen, before.platforms.app.everSeen)).toBe(2);
    expect(diff(after.platforms.app.activeLast30Days, before.platforms.app.activeLast30Days)).toBe(2);
    expect(diff(after.platforms.both, before.platforms.both)).toBe(1);
  });

  it("splits employees into free and paid, treating a lapsed paid plan as free", () => {
    expect(diff(after.plans.employees.paid, before.plans.employees.paid)).toBe(1);
    expect(diff(after.plans.employees.free, before.plans.employees.free)).toBe(2);
  });

  it("counts companies per tier", () => {
    expect(diff(after.plans.companies.basic, before.plans.companies.basic)).toBe(1);
    expect(diff(after.plans.companies.pro, before.plans.companies.pro)).toBe(1);
  });

  it("sums only approved payments into revenue, and reports pending separately", () => {
    expect(diff(after.revenue.totalCup, before.revenue.totalCup)).toBe(1250);
    expect(diff(after.revenue.approvedCount, before.revenue.approvedCount)).toBe(2);
    expect(diff(after.revenue.pendingCount, before.revenue.pendingCount)).toBe(1);
    expect(diff(after.revenue.pendingCup, before.revenue.pendingCup)).toBe(400);
    expect(diff(after.revenue.rejectedCount, before.revenue.rejectedCount)).toBe(1);
  });

  it("windows revenue by approval date", () => {
    // The 40-day-old payment counts toward the total but not the last 30 days.
    expect(diff(after.revenue.last30DaysCup, before.revenue.last30DaysCup)).toBe(1000);
    expect(diff(after.revenue.thisMonthCup, before.revenue.thisMonthCup)).toBe(1000);
  });

  it("groups revenue by plan and returns six months, oldest first, empty months included", () => {
    const row = (m: AdminMetrics) => m.revenue.byPlan.find((p) => p.code === "employee_paid");
    expect((row(after)?.amountCup ?? 0) - (row(before)?.amountCup ?? 0)).toBe(1250);
    expect((row(after)?.count ?? 0) - (row(before)?.count ?? 0)).toBe(2);

    expect(after.revenue.byMonth).toHaveLength(6);
    const months = after.revenue.byMonth.map((m) => m.month);
    expect([...months].sort()).toEqual(months);
    const thisMonth = after.revenue.byMonth.at(-1)!;
    const prevThisMonth = before.revenue.byMonth.at(-1)!;
    expect(thisMonth.amountCup - prevThisMonth.amountCup).toBe(1000);
  });
});

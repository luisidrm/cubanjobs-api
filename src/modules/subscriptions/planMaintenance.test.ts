import { randomUUID } from "node:crypto";
import { eq, inArray, or } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../../db/client";
import { companies, companyMembers, notifications, planEvents, users } from "../../../db";

// No Redis in unit tests: capture what would have been queued instead.
const enqueued: Array<{ email: string; subject: string; pushTitle: string; html: string }> = [];
vi.mock("../../lib/queue", () => ({
  enqueuePlanNotification: vi.fn(async (job) => {
    enqueued.push(job);
  }),
  enqueueApplicationStatusNotification: vi.fn(),
  closeNotificationQueue: vi.fn(),
  startPlanMaintenance: vi.fn(),
}));

const { downgradeExpiredPlans, sendExpiryReminders, runPlanMaintenance, buildNoticeCopy } = await import("./planMaintenance");

const suffix = randomUUID().slice(0, 8);
const userIds: string[] = [];
const companyIds: string[] = [];
const DAY = 86_400_000;

async function makeUser(role: "employee" | "employer", label: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const [u] = await db
    .insert(users)
    .values({ supertokensUserId: `pm-${suffix}-${label}`, email: `${label}-${suffix}@example.com`, role, ...extra })
    .returning();
  userIds.push(u!.id);
  return u!;
}

async function makeCompany(owner: { id: string }, extra: Partial<typeof companies.$inferInsert> = {}) {
  const [c] = await db
    .insert(companies)
    .values({ name: `PM Co ${randomUUID().slice(0, 6)}`, ownerId: owner.id, ...extra })
    .returning();
  companyIds.push(c!.id);
  await db.insert(companyMembers).values({ companyId: c!.id, userId: owner.id, role: "owner" });
  return c!;
}

const mine = () => enqueued.filter((e) => e.email.includes(suffix));

beforeEach(() => {
  enqueued.length = 0;
});

afterAll(async () => {
  await db.delete(notifications).where(inArray(notifications.userId, userIds));
  await db.delete(planEvents).where(or(inArray(planEvents.userId, userIds), inArray(planEvents.companyId, companyIds)));
  await db.delete(companies).where(inArray(companies.id, companyIds));
  await db.delete(users).where(inArray(users.id, userIds));
});

describe("sendExpiryReminders", () => {
  it("warns an employee 3 days out, once, with a notification and an email", async () => {
    const now = new Date();
    const u = await makeUser("employee", "r1", { plan: "paid", planSource: "transfermovil", planExpiresAt: new Date(now.getTime() + 2.5 * DAY) });

    await sendExpiryReminders(now);
    const notes = await db.select().from(notifications).where(eq(notifications.userId, u.id));
    expect(notes.map((n) => n.type)).toEqual(["plan_expiring"]);
    expect(mine().filter((e) => e.email.startsWith("r1-"))).toHaveLength(1);

    // A second run in the same period must not repeat it.
    await sendExpiryReminders(now);
    expect(await db.select().from(notifications).where(eq(notifications.userId, u.id))).toHaveLength(1);
    expect(mine().filter((e) => e.email.startsWith("r1-"))).toHaveLength(1);
  });

  it("leaves alone plans that are far from expiry, open-ended, Stripe-managed or free", async () => {
    const now = new Date();
    const far = await makeUser("employee", "r2a", { plan: "paid", planSource: "transfermovil", planExpiresAt: new Date(now.getTime() + 10 * DAY) });
    const open = await makeUser("employee", "r2b", { plan: "paid", planSource: "manual", planExpiresAt: null });
    const owner = await makeUser("employer", "r2c");
    await makeCompany(owner, { planTier: "pro", planSource: "stripe", planExpiresAt: new Date(now.getTime() + 1 * DAY) });
    const free = await makeUser("employee", "r2d", { plan: "free", planExpiresAt: new Date(now.getTime() + 1 * DAY) });

    await sendExpiryReminders(now);
    for (const u of [far, open, owner, free]) {
      expect(await db.select().from(notifications).where(eq(notifications.userId, u.id))).toHaveLength(0);
    }
  });

  it("notifies every owner/admin of an expiring company", async () => {
    const now = new Date();
    const owner = await makeUser("employer", "r3a");
    const second = await makeUser("employer", "r3b");
    const company = await makeCompany(owner, { planTier: "basic", planSource: "transfermovil", planExpiresAt: new Date(now.getTime() + 2 * DAY) });
    await db.insert(companyMembers).values({ companyId: company.id, userId: second.id, role: "admin" });

    await sendExpiryReminders(now);
    for (const u of [owner, second]) {
      const notes = await db.select().from(notifications).where(eq(notifications.userId, u.id));
      expect(notes).toHaveLength(1);
      expect(notes[0]!.body).toContain(company.name);
    }
  });

  it("warns again after a renewal clears the flag", async () => {
    const now = new Date();
    const u = await makeUser("employee", "r4", { plan: "paid", planSource: "transfermovil", planExpiresAt: new Date(now.getTime() + 2 * DAY) });
    await sendExpiryReminders(now);
    await db.update(users).set({ planReminderSentAt: null, planExpiresAt: new Date(now.getTime() + 2 * DAY) }).where(eq(users.id, u.id));
    await sendExpiryReminders(now);
    expect(await db.select().from(notifications).where(eq(notifications.userId, u.id))).toHaveLength(2);
  });
});

describe("downgradeExpiredPlans", () => {
  it("moves a lapsed employee to free, logs it and tells them", async () => {
    const now = new Date();
    const u = await makeUser("employee", "d1", { plan: "paid", planSource: "transfermovil", planExpiresAt: new Date(now.getTime() - 1000) });

    await downgradeExpiredPlans(now);
    const [after] = await db.select().from(users).where(eq(users.id, u.id));
    expect(after).toMatchObject({ plan: "free", planSource: "none", planExpiresAt: null });
    const events = await db.select().from(planEvents).where(eq(planEvents.userId, u.id));
    expect(events[0]).toMatchObject({ fromPlan: "employee_paid", toPlan: "free", reason: "expired" });
    const notes = await db.select().from(notifications).where(eq(notifications.userId, u.id));
    expect(notes.map((n) => n.type)).toEqual(["plan_expired"]);
    expect(mine().some((e) => e.email.startsWith("d1-"))).toBe(true);
  });

  it("moves a lapsed company to the free tier and keeps its jobs untouched", async () => {
    const now = new Date();
    const owner = await makeUser("employer", "d2");
    const company = await makeCompany(owner, { planTier: "pro", planSource: "manual", planExpiresAt: new Date(now.getTime() - DAY) });

    await downgradeExpiredPlans(now);
    const [after] = await db.select().from(companies).where(eq(companies.id, company.id));
    expect(after).toMatchObject({ planTier: "free", planSource: "none", planExpiresAt: null });
    expect((await db.select().from(planEvents).where(eq(planEvents.companyId, company.id)))[0]).toMatchObject({
      fromPlan: "pro",
      toPlan: "free",
      reason: "expired",
    });
  });

  it("never touches Stripe-managed, open-ended or still-active plans", async () => {
    const now = new Date();
    const stripeOwner = await makeUser("employer", "d3a");
    const stripeCo = await makeCompany(stripeOwner, { planTier: "pro", planSource: "stripe", planExpiresAt: new Date(now.getTime() - DAY) });
    const open = await makeUser("employee", "d3b", { plan: "paid", planSource: "manual", planExpiresAt: null });
    const active = await makeUser("employee", "d3c", { plan: "paid", planSource: "transfermovil", planExpiresAt: new Date(now.getTime() + 20 * DAY) });

    await downgradeExpiredPlans(now);
    expect((await db.select().from(companies).where(eq(companies.id, stripeCo.id)))[0]!.planTier).toBe("pro");
    expect((await db.select().from(users).where(eq(users.id, open.id)))[0]!.plan).toBe("paid");
    expect((await db.select().from(users).where(eq(users.id, active.id)))[0]!.plan).toBe("paid");
  });

  it("is idempotent: a second run does nothing", async () => {
    const now = new Date();
    const u = await makeUser("employee", "d4", { plan: "paid", planSource: "transfermovil", planExpiresAt: new Date(now.getTime() - 1000) });
    await downgradeExpiredPlans(now);
    await downgradeExpiredPlans(now);
    expect(await db.select().from(planEvents).where(eq(planEvents.userId, u.id))).toHaveLength(1);
    expect(await db.select().from(notifications).where(eq(notifications.userId, u.id))).toHaveLength(1);
  });
});

describe("runPlanMaintenance", () => {
  it("downgrades before warning, so an expired plan never gets an 'expires soon' message", async () => {
    const now = new Date();
    const lapsed = await makeUser("employee", "m1", { plan: "paid", planSource: "transfermovil", planExpiresAt: new Date(now.getTime() - 1000) });
    const soon = await makeUser("employee", "m2", { plan: "paid", planSource: "transfermovil", planExpiresAt: new Date(now.getTime() + 2 * DAY) });

    await runPlanMaintenance(now);
    expect((await db.select().from(notifications).where(eq(notifications.userId, lapsed.id))).map((n) => n.type)).toEqual(["plan_expired"]);
    expect((await db.select().from(notifications).where(eq(notifications.userId, soon.id))).map((n) => n.type)).toEqual(["plan_expiring"]);
  });
});

describe("copy", () => {
  it("is bilingual and names the company", () => {
    const c = buildNoticeCopy({ kind: "expiring", planName: "Pro", companyName: "Acme", expiresAt: new Date("2026-11-20T00:00:00Z") });
    expect(c.body).toContain("2026-11-20");
    expect(c.body).toContain("Acme");
    expect(c.body).toContain("Renuévalo");
    expect(c.body).toContain("Renew");
  });
});

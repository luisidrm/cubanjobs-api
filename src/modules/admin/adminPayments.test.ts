import { randomUUID } from "node:crypto";
import { eq, inArray, or } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { db } from "../../../db/client";
import { companies, companyMembers, paymentSettings, payments, planEvents, planPrices, plans, users } from "../../../db";

vi.mock("../../lib/minio", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/minio")>();
  return {
    ...actual,
    uploadPrivateFile: vi.fn().mockResolvedValue(undefined),
    deletePrivateFile: vi.fn().mockResolvedValue(undefined),
    getSignedUrl: vi.fn(async (key: string) => `https://signed.example/${key}`),
  };
});
vi.mock("../../lib/queue", () => ({
  enqueuePlanNotification: vi.fn(),
  enqueueApplicationStatusNotification: vi.fn(),
  closeNotificationQueue: vi.fn(),
  startPlanMaintenance: vi.fn(),
}));

const q = await import("./adminPayments.queries");
const s = await import("./adminPayments.schemas");
const { submitPayment } = await import("../payments/payments.queries");
const { default: app } = await import("../../app");

const suffix = randomUUID().slice(0, 8);
const userIds: string[] = [];
const companyIds: string[] = [];
const planIds: string[] = [];
const DAY = 86_400_000;
let originalReminder: string | undefined;

async function makeUser(role: "employee" | "employer" | "admin", label: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const [u] = await db
    .insert(users)
    .values({ supertokensUserId: `ap-${suffix}-${label}`, email: `${label}-${suffix}@example.com`, role, ...extra })
    .returning();
  userIds.push(u!.id);
  return u!;
}

async function makeCompany(owner: { id: string }, extra: Partial<typeof companies.$inferInsert> = {}) {
  const [c] = await db.insert(companies).values({ name: `AP Co ${suffix} ${randomUUID().slice(0, 4)}`, ownerId: owner.id, ...extra }).returning();
  companyIds.push(c!.id);
  await db.insert(companyMembers).values({ companyId: c!.id, userId: owner.id, role: "owner" });
  return c!;
}

const num = () => `AD${randomUUID().replace(/-/g, "").slice(0, 10)}`;

beforeAll(async () => {
  const [row] = await db.select().from(paymentSettings).where(eq(paymentSettings.key, "reminder_days_before"));
  originalReminder = row?.value;
});

afterAll(async () => {
  if (originalReminder !== undefined) {
    await db.update(paymentSettings).set({ value: originalReminder }).where(eq(paymentSettings.key, "reminder_days_before"));
  }
  await db.delete(planEvents).where(or(inArray(planEvents.userId, userIds), inArray(planEvents.companyId, companyIds)));
  for (const id of userIds) await db.delete(payments).where(eq(payments.userId, id));
  await db.delete(plans).where(inArray(plans.id, planIds));
  await db.delete(companies).where(inArray(companies.id, companyIds));
  await db.delete(users).where(inArray(users.id, userIds));
});

describe("access control", () => {
  it("refuses unauthenticated requests to the admin payments API", async () => {
    for (const path of ["/api/v1/admin/payments", "/api/v1/admin/plans", "/api/v1/admin/payment-settings", "/api/v1/admin/accounts/expiring"]) {
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
    }
    expect((await request(app).post("/api/v1/payments").send({})).status).toBe(401);
  });
});

describe("payments queue", () => {
  it("filters by status and lists the oldest pending first with company and screenshot info", async () => {
    const owner = await makeUser("employer", "q1");
    const company = await makeCompany(owner);
    const first = await submitPayment(
      { id: owner.id, email: owner.email, role: "employer" },
      { planCode: "basic", months: 1, companyId: company.id, transferNumber: num() },
      { buffer: Buffer.from("x"), mimetype: "image/png" }
    );
    const emp = await makeUser("employee", "q2");
    await submitPayment({ id: emp.id, email: emp.email, role: "employee" }, { planCode: "employee_paid", months: 1, transferNumber: num() });

    const pending = (await q.listPayments("pending", 100, 0)).filter((p) => p.payerEmail.includes(suffix));
    expect(pending.map((p) => p.payerEmail)).toEqual([owner.email, emp.email]);
    expect(pending[0]).toMatchObject({ companyName: company.name, planCode: "basic", hasScreenshot: true, audience: "employer" });
    expect(pending[1]).toMatchObject({ companyName: null, hasScreenshot: false });
    expect(await q.listPayments("approved", 100, 0).then((r) => r.filter((p) => p.payerEmail.includes(suffix)))).toHaveLength(0);
    expect(first.id).toBe(pending[0]!.id);
  });

  it("returns the detail with a signed screenshot link and the account's current plan", async () => {
    const owner = await makeUser("employer", "q3");
    const company = await makeCompany(owner, { planTier: "basic", planSource: "manual", planExpiresAt: new Date(Date.now() + 5 * DAY) });
    const p = await submitPayment(
      { id: owner.id, email: owner.email, role: "employer" },
      { planCode: "basic", months: 1, companyId: company.id, transferNumber: num() },
      { buffer: Buffer.from("x"), mimetype: "image/jpeg" }
    );
    const detail = await q.getPaymentDetail(p.id);
    expect(detail.screenshotUrl).toBe(`https://signed.example/payments/${p.id}/screenshot.jpg`);
    expect(detail.account).toMatchObject({ kind: "company", id: company.id, plan: "basic", planSource: "manual" });
    await expect(q.getPaymentDetail(randomUUID())).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("accounts", () => {
  it("finds employees by email and companies by name or owner email", async () => {
    const emp = await makeUser("employee", "s1");
    const owner = await makeUser("employer", "s2");
    const company = await makeCompany(owner);

    expect((await q.searchAccounts(`s1-${suffix}`)).some((a) => a.kind === "user" && a.id === emp.id)).toBe(true);
    expect((await q.searchAccounts(`s2-${suffix}`)).some((a) => a.kind === "company" && a.id === company.id)).toBe(true);
    expect((await q.searchAccounts(company.name)).some((a) => a.id === company.id)).toBe(true);
  });

  it("lists paid accounts ending inside the window, soonest first", async () => {
    const now = new Date();
    const soon = await makeUser("employee", "x1", { plan: "paid", planSource: "transfermovil", planExpiresAt: new Date(now.getTime() + 2 * DAY) });
    const later = await makeUser("employee", "x2", { plan: "paid", planSource: "transfermovil", planExpiresAt: new Date(now.getTime() + 6 * DAY) });
    const far = await makeUser("employee", "x3", { plan: "paid", planSource: "transfermovil", planExpiresAt: new Date(now.getTime() + 30 * DAY) });
    const open = await makeUser("employee", "x4", { plan: "paid", planSource: "manual", planExpiresAt: null });

    const ids = (await q.getExpiringAccounts(7, now)).map((a) => a.id);
    expect(ids.indexOf(soon.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(soon.id)).toBeLessThan(ids.indexOf(later.id));
    expect(ids).not.toContain(far.id);
    expect(ids).not.toContain(open.id);
  });
});

describe("plans, prices and settings", () => {
  it("edits a plan and upserts its prices without touching the seeded catalog", async () => {
    const [plan] = await db
      .insert(plans)
      .values({ code: `tmp-${suffix}`, audience: "employer", name: "Temp", jobLimit: 5, sortOrder: 99 })
      .returning();
    planIds.push(plan!.id);

    expect(await q.updatePlan(plan!.id, { name: "Temp 2", jobLimit: null, isActive: false })).toMatchObject({ name: "Temp 2", jobLimit: null, isActive: false });
    await expect(q.updatePlan(randomUUID(), { name: "x" })).rejects.toMatchObject({ statusCode: 404 });

    await q.upsertPlanPrice(plan!.id, 1, 1000, true);
    await q.upsertPlanPrice(plan!.id, 1, 1200, false);
    const rows = await db.select().from(planPrices).where(eq(planPrices.planId, plan!.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ priceCup: 1200, isActive: false });
    await expect(q.upsertPlanPrice(randomUUID(), 1, 1, true)).rejects.toMatchObject({ statusCode: 404 });

    const all = await q.getAllPlansForAdmin();
    const temp = all.find((p) => p.id === plan!.id);
    expect(temp).toMatchObject({ isActive: false });
    expect(temp!.prices).toEqual([{ months: 1, priceCup: 1200, isActive: false }]);
  });

  it("upserts settings and returns them all", async () => {
    const out = await q.updateSettings({ reminder_days_before: "5" });
    expect(out.reminder_days_before).toBe("5");
    expect(out.destination_card).toBeDefined();
  });

  it("validates the editable inputs", () => {
    expect(s.updateSettingsSchema.safeParse({ reminder_days_before: "3" }).success).toBe(true);
    expect(s.updateSettingsSchema.safeParse({ reminder_days_before: "0" }).success).toBe(false);
    expect(s.updateSettingsSchema.safeParse({ reminder_days_before: "abc" }).success).toBe(false);
    expect(s.updateSettingsSchema.safeParse({ not_a_setting: "x" }).success).toBe(false);
    expect(s.updateSettingsSchema.safeParse({}).success).toBe(false);

    expect(s.upsertPriceSchema.safeParse({ priceCup: 450 }).success).toBe(true);
    expect(s.upsertPriceSchema.safeParse({ priceCup: 0 }).success).toBe(false);
    expect(s.upsertPriceSchema.safeParse({ priceCup: 4.5 }).success).toBe(false);
    expect(s.rejectPaymentSchema.safeParse({ reason: "no" }).success).toBe(false);
    expect(s.updatePlanSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a future expiry or none, and refuses a past one", () => {
    const future = new Date(Date.now() + 5 * DAY).toISOString();
    const parsed = s.setUserPlanSchema.parse({ plan: "paid", expiresAt: future });
    expect(parsed.expiresAt).toBeInstanceOf(Date);
    expect(s.setUserPlanSchema.parse({ plan: "paid" }).expiresAt).toBeNull();
    expect(s.setUserPlanSchema.parse({ plan: "free", expiresAt: null }).expiresAt).toBeNull();
    expect(s.setCompanyPlanSchema.safeParse({ plan: "pro", expiresAt: new Date(Date.now() - DAY).toISOString() }).success).toBe(false);
    expect(s.setCompanyPlanSchema.safeParse({ plan: "gold" }).success).toBe(false);
  });
});

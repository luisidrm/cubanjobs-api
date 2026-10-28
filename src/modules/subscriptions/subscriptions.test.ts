import { randomUUID } from "node:crypto";
import { eq, inArray, or } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../../db/client";
import { companies, companyMembers, notifications, payments, planEvents, users } from "../../../db";
import { AppError } from "../../lib/AppError";

// Screenshot uploads would hit MinIO; the behavior under test is ours, not the bucket's.
vi.mock("../../lib/minio", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/minio")>();
  return {
    ...actual,
    uploadPrivateFile: vi.fn().mockResolvedValue(undefined),
    deletePrivateFile: vi.fn().mockResolvedValue(undefined),
  };
});

// The service also queues the email/push; keep the real queue (and its worker) out of tests.
const queued: Array<{ email: string; subject: string }> = [];
vi.mock("../../lib/queue", () => ({
  enqueuePlanNotification: vi.fn(async (job) => {
    queued.push(job);
  }),
  enqueueApplicationStatusNotification: vi.fn(),
  closeNotificationQueue: vi.fn(),
  startPlanMaintenance: vi.fn(),
}));

const { submitPayment, MAX_PENDING_PER_USER } = await import("../payments/payments.queries");
const { approvePayment, rejectPayment, setPlanManually, hasActiveEmployeePlan, computeNewExpiry, addMonths, isPlanActive } =
  await import("./subscriptions.service");
const { requirePaidEmployee } = await import("../../middleware/plan");

const suffix = randomUUID().slice(0, 8);
const userIds: string[] = [];
const companyIds: string[] = [];

async function makeUser(role: "employee" | "employer" | "admin", label: string) {
  const [u] = await db
    .insert(users)
    .values({ supertokensUserId: `st-${suffix}-${label}`, email: `${label}-${suffix}@example.com`, role })
    .returning();
  userIds.push(u!.id);
  return u!;
}

async function makeCompany(ownerId: string, extra: Partial<typeof companies.$inferInsert> = {}) {
  const [c] = await db
    .insert(companies)
    .values({ name: `Pay Co ${randomUUID().slice(0, 6)}`, ownerId, ...extra })
    .returning();
  companyIds.push(c!.id);
  await db.insert(companyMembers).values({ companyId: c!.id, userId: ownerId, role: "owner" });
  return c!;
}

let admin: typeof users.$inferSelect;

beforeAll(async () => {
  admin = await makeUser("admin", "admin");
});

afterAll(async () => {
  await db.delete(notifications).where(inArray(notifications.userId, userIds));
  await db.delete(planEvents).where(or(inArray(planEvents.userId, userIds), inArray(planEvents.companyId, companyIds)));
  for (const id of userIds) await db.delete(payments).where(eq(payments.userId, id));
  await db.delete(companies).where(inArray(companies.id, companyIds));
  await db.delete(users).where(inArray(users.id, userIds));
});

const num = () => `TM${randomUUID().replace(/-/g, "").slice(0, 10)}`;

describe("date rules", () => {
  it("adds calendar months and clamps the day", () => {
    expect(addMonths(new Date("2026-01-31T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(addMonths(new Date("2026-10-15T00:00:00Z"), 3).toISOString().slice(0, 10)).toBe("2027-01-15");
  });

  it("stacks on an active expiry and starts from now when lapsed", () => {
    const now = new Date("2026-10-15T00:00:00Z");
    const active = new Date("2026-10-20T00:00:00Z");
    expect(computeNewExpiry(active, 1, now).toISOString().slice(0, 10)).toBe("2026-11-20");
    expect(computeNewExpiry(new Date("2026-10-01T00:00:00Z"), 1, now).toISOString().slice(0, 10)).toBe("2026-11-15");
    expect(computeNewExpiry(null, 1, now).toISOString().slice(0, 10)).toBe("2026-11-15");
  });

  it("treats a missing expiry as never lapsing", () => {
    expect(isPlanActive(null)).toBe(true);
    expect(isPlanActive(new Date(Date.now() - 1000))).toBe(false);
  });
});

describe("submitPayment", () => {
  it("records an employee payment with the price snapshot", async () => {
    const u = await makeUser("employee", "e1");
    const p = await submitPayment({ id: u.id, email: u.email, role: "employee" }, {
      planCode: "employee_paid",
      months: 3,
      transferNumber: num(),
    });
    expect(p.status).toBe("pending");
    expect(p.amountCup).toBe(450 * 3);
    expect(p.companyId).toBeNull();
  });

  it("blocks a transfer number that was already used, however it is typed", async () => {
    const a = await makeUser("employee", "e2a");
    const b = await makeUser("employee", "e2b");
    const n = num();
    await submitPayment({ id: a.id, email: a.email, role: "employee" }, { planCode: "employee_paid", months: 1, transferNumber: n });
    await expect(
      submitPayment({ id: b.id, email: b.email, role: "employee" }, { planCode: "employee_paid", months: 1, transferNumber: n.toLowerCase().replace("tm", "tm-") })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("frees the number after a rejection so the user can resubmit", async () => {
    const u = await makeUser("employee", "e3");
    const n = num();
    const first = await submitPayment({ id: u.id, email: u.email, role: "employee" }, { planCode: "employee_paid", months: 1, transferNumber: n });
    await rejectPayment(first.id, admin.id, "Number not found");
    const again = await submitPayment({ id: u.id, email: u.email, role: "employee" }, { planCode: "employee_paid", months: 1, transferNumber: n });
    expect(again.status).toBe("pending");
  });

  it("rejects the wrong audience, unknown duration and missing company", async () => {
    const emp = await makeUser("employee", "e4");
    const boss = await makeUser("employer", "r4");
    await expect(
      submitPayment({ id: emp.id, email: emp.email, role: "employee" }, { planCode: "pro", months: 1, transferNumber: num() })
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      submitPayment({ id: emp.id, email: emp.email, role: "employee" }, { planCode: "employee_paid", months: 2, transferNumber: num() })
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      submitPayment({ id: boss.id, email: boss.email, role: "employer" }, { planCode: "pro", months: 1, transferNumber: num() })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("only lets an employer pay for a company they manage", async () => {
    const owner = await makeUser("employer", "r5a");
    const stranger = await makeUser("employer", "r5b");
    const company = await makeCompany(owner.id);
    await expect(
      submitPayment({ id: stranger.id, email: stranger.email, role: "employer" }, { planCode: "basic", months: 1, companyId: company.id, transferNumber: num() })
    ).rejects.toMatchObject({ statusCode: 403 });
    const p = await submitPayment({ id: owner.id, email: owner.email, role: "employer" }, { planCode: "basic", months: 1, companyId: company.id, transferNumber: num() });
    expect(p.companyId).toBe(company.id);
  });

  it("caps pending payments per user", async () => {
    const u = await makeUser("employee", "e6");
    for (let i = 0; i < MAX_PENDING_PER_USER; i++) {
      await submitPayment({ id: u.id, email: u.email, role: "employee" }, { planCode: "employee_paid", months: 1, transferNumber: num() });
    }
    await expect(
      submitPayment({ id: u.id, email: u.email, role: "employee" }, { planCode: "employee_paid", months: 1, transferNumber: num() })
    ).rejects.toMatchObject({ statusCode: 429 });
  });

  it("stores the screenshot key when one is provided", async () => {
    const u = await makeUser("employee", "e7");
    const p = await submitPayment(
      { id: u.id, email: u.email, role: "employee" },
      { planCode: "employee_paid", months: 1, transferNumber: num() },
      { buffer: Buffer.from("x"), mimetype: "image/png" }
    );
    expect(p.screenshotKey).toBe(`payments/${p.id}/screenshot.png`);
  });
});

describe("approvePayment", () => {
  it("makes an employee paid until the end of the period and notifies them", async () => {
    const u = await makeUser("employee", "a1");
    const p = await submitPayment({ id: u.id, email: u.email, role: "employee" }, { planCode: "employee_paid", months: 1, transferNumber: num() });
    expect(await hasActiveEmployeePlan(u.id)).toBe(false);

    const result = await approvePayment(p.id, admin.id);
    expect(result.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 27 * 86400000);

    const [after] = await db.select().from(users).where(eq(users.id, u.id));
    expect(after!.plan).toBe("paid");
    expect(after!.planSource).toBe("transfermovil");
    expect(await hasActiveEmployeePlan(u.id)).toBe(true);

    const notes = await db.select().from(notifications).where(eq(notifications.userId, u.id));
    expect(notes.some((n) => n.type === "payment_approved")).toBe(true);
    expect(queued.some((q) => q.email === u.email && q.subject.startsWith("Pago aprobado"))).toBe(true);
    const events = await db.select().from(planEvents).where(eq(planEvents.userId, u.id));
    expect(events[0]).toMatchObject({ fromPlan: "free", toPlan: "employee_paid", reason: "payment_approved" });
  });

  it("stacks an early renewal on the current expiry", async () => {
    const u = await makeUser("employee", "a2");
    const current = new Date(Date.now() + 5 * 86400000);
    await db.update(users).set({ plan: "paid", planExpiresAt: current, planSource: "transfermovil" }).where(eq(users.id, u.id));
    const p = await submitPayment({ id: u.id, email: u.email, role: "employee" }, { planCode: "employee_paid", months: 1, transferNumber: num() });
    const result = await approvePayment(p.id, admin.id);
    expect(result.expiresAt!.getTime()).toBe(addMonths(current, 1).getTime());
  });

  it("sets an employer company tier and expiry", async () => {
    const owner = await makeUser("employer", "a3");
    const company = await makeCompany(owner.id);
    const p = await submitPayment({ id: owner.id, email: owner.email, role: "employer" }, { planCode: "pro", months: 6, companyId: company.id, transferNumber: num() });
    expect(p.amountCup).toBe(3000 * 6);
    await approvePayment(p.id, admin.id);
    const [after] = await db.select().from(companies).where(eq(companies.id, company.id));
    expect(after).toMatchObject({ planTier: "pro", planSource: "transfermovil" });
    expect(after!.planExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 170 * 86400000);
  });

  it("refuses to override an active Stripe subscription", async () => {
    const owner = await makeUser("employer", "a4");
    const company = await makeCompany(owner.id, { planTier: "basic", planSource: "stripe", stripeSubscriptionId: `sub_${suffix}` });
    const p = await submitPayment({ id: owner.id, email: owner.email, role: "employer" }, { planCode: "pro", months: 1, companyId: company.id, transferNumber: num() });
    await expect(approvePayment(p.id, admin.id)).rejects.toMatchObject({ statusCode: 409 });
    const [after] = await db.select().from(companies).where(eq(companies.id, company.id));
    expect(after!.planTier).toBe("basic");
  });

  it("cannot be approved or rejected twice", async () => {
    const u = await makeUser("employee", "a5");
    const p = await submitPayment({ id: u.id, email: u.email, role: "employee" }, { planCode: "employee_paid", months: 1, transferNumber: num() });
    await approvePayment(p.id, admin.id);
    await expect(approvePayment(p.id, admin.id)).rejects.toBeInstanceOf(AppError);
    await expect(rejectPayment(p.id, admin.id, "late")).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("rejectPayment", () => {
  it("stores the reason and tells the user", async () => {
    const u = await makeUser("employee", "j1");
    const p = await submitPayment({ id: u.id, email: u.email, role: "employee" }, { planCode: "employee_paid", months: 1, transferNumber: num() });
    const r = await rejectPayment(p.id, admin.id, "Amount does not match");
    expect(r).toMatchObject({ status: "rejected", rejectReason: "Amount does not match", reviewedBy: admin.id });
    const notes = await db.select().from(notifications).where(eq(notifications.userId, u.id));
    expect(notes.some((n) => n.type === "payment_rejected")).toBe(true);
    expect(queued.some((q) => q.email === u.email && q.subject.startsWith("Pago rechazado"))).toBe(true);
  });
});

describe("setPlanManually", () => {
  it("grants and removes an employee plan, logging each change", async () => {
    const u = await makeUser("employee", "m1");
    await setPlanManually({ userId: u.id, plan: "paid" }, null, admin.id, "gift");
    let [row] = await db.select().from(users).where(eq(users.id, u.id));
    expect(row).toMatchObject({ plan: "paid", planSource: "manual", planExpiresAt: null });
    expect(await hasActiveEmployeePlan(u.id)).toBe(true);

    await setPlanManually({ userId: u.id, plan: "free" }, null, admin.id);
    [row] = await db.select().from(users).where(eq(users.id, u.id));
    expect(row).toMatchObject({ plan: "free", planSource: "none" });
    expect((await db.select().from(planEvents).where(eq(planEvents.userId, u.id))).length).toBe(2);
  });

  it("sets a company tier with an expiry", async () => {
    const owner = await makeUser("employer", "m2");
    const company = await makeCompany(owner.id);
    const end = new Date(Date.now() + 10 * 86400000);
    await setPlanManually({ companyId: company.id, plan: "basic" }, end, admin.id);
    const [row] = await db.select().from(companies).where(eq(companies.id, company.id));
    expect(row).toMatchObject({ planTier: "basic", planSource: "manual" });
    expect(row!.planExpiresAt!.getTime()).toBe(end.getTime());
  });
});

describe("requirePaidEmployee", () => {
  it("answers 402 PLAN_REQUIRED for free employees and passes paid ones", async () => {
    const free = await makeUser("employee", "g1");
    const paid = await makeUser("employee", "g2");
    await db.update(users).set({ plan: "paid", planSource: "manual" }).where(eq(users.id, paid.id));

    const run = async (id: string) => {
      const next = vi.fn();
      await requirePaidEmployee({ user: { id } } as never, {} as never, next);
      return next.mock.calls[0]?.[0] as (AppError & { details?: unknown }) | undefined;
    };

    const denied = await run(free.id);
    expect(denied).toMatchObject({ statusCode: 402, details: { code: "PLAN_REQUIRED" } });
    expect(await run(paid.id)).toBeUndefined();
  });
});

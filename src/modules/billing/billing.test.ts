import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { db } from "../../../db/client";
import { companies } from "../../../db";
import { applyCheckoutCompleted, applySubscriptionUpdated, applySubscriptionDeleted } from "./billing.queries";

vi.mock("../../lib/stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/stripe")>();
  return {
    ...actual,
    stripe: {
      ...actual.stripe,
      subscriptions: { retrieve: vi.fn() },
      customers: { retrieve: vi.fn() },
    },
  };
});

const { stripe, STRIPE_PRICE_IDS } = await import("../../lib/stripe");
const { default: app } = await import("../../app");

const createdCompanyIds: string[] = [];

async function makeCompany() {
  const [company] = await db
    .insert(companies)
    .values({ name: `Billing Test Co ${randomUUID().slice(0, 8)}`, planTier: "free" })
    .returning();
  createdCompanyIds.push(company!.id);
  return company!;
}

afterAll(async () => {
  await db.delete(companies).where(inArray(companies.id, createdCompanyIds));
});

describe("applyCheckoutCompleted", () => {
  it("flips a company to the purchased plan and stores subscription state", async () => {
    const company = await makeCompany();
    vi.mocked(stripe.subscriptions.retrieve).mockResolvedValueOnce({
      id: "sub_test_1",
      status: "active",
      items: { data: [{ current_period_end: 1893456000, price: { id: STRIPE_PRICE_IDS.basic } }] },
    } as never);

    await applyCheckoutCompleted({
      id: "cs_test_1",
      metadata: { companyId: company.id, plan: "basic" },
      subscription: "sub_test_1",
    } as unknown as Stripe.Checkout.Session);

    const [updated] = await db.select().from(companies).where(eq(companies.id, company.id));
    expect(updated?.planTier).toBe("basic");
    expect(updated?.stripeSubscriptionId).toBe("sub_test_1");
    expect(updated?.stripeSubscriptionStatus).toBe("active");
    expect(updated?.currentPeriodEnd).toBeInstanceOf(Date);
  });
});

describe("applySubscriptionUpdated", () => {
  it("upgrades the plan tier to match the subscription's current price", async () => {
    const company = await makeCompany();
    vi.mocked(stripe.customers.retrieve).mockResolvedValueOnce({
      deleted: false,
      metadata: { companyId: company.id },
    } as never);

    await applySubscriptionUpdated({
      id: "sub_test_2",
      customer: "cus_test_2",
      status: "active",
      items: { data: [{ current_period_end: 1893456000, price: { id: STRIPE_PRICE_IDS.pro } }] },
    } as never);

    const [updated] = await db.select().from(companies).where(eq(companies.id, company.id));
    expect(updated?.planTier).toBe("pro");
  });

  it("downgrades to free when the subscription status is inactive, regardless of price", async () => {
    const company = await makeCompany();
    vi.mocked(stripe.customers.retrieve).mockResolvedValueOnce({
      deleted: false,
      metadata: { companyId: company.id },
    } as never);

    await applySubscriptionUpdated({
      id: "sub_test_3",
      customer: "cus_test_3",
      status: "canceled",
      items: { data: [{ current_period_end: 1893456000, price: { id: STRIPE_PRICE_IDS.pro } }] },
    } as never);

    const [updated] = await db.select().from(companies).where(eq(companies.id, company.id));
    expect(updated?.planTier).toBe("free");
  });
});

describe("applySubscriptionDeleted", () => {
  it("resets the company to the free plan", async () => {
    const company = await makeCompany();
    vi.mocked(stripe.customers.retrieve).mockResolvedValueOnce({
      deleted: false,
      metadata: { companyId: company.id },
    } as never);

    await applySubscriptionDeleted({
      id: "sub_test_4",
      customer: "cus_test_4",
    } as never);

    const [updated] = await db.select().from(companies).where(eq(companies.id, company.id));
    expect(updated?.planTier).toBe("free");
    expect(updated?.stripeSubscriptionStatus).toBe("canceled");
  });
});

describe("POST /api/v1/billing/webhook", () => {
  it("rejects a request with an invalid/missing signature", async () => {
    const res = await request(app)
      .post("/api/v1/billing/webhook")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ type: "checkout.session.completed" }));

    expect(res.status).toBe(400);
  });
});

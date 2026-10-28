import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { companies, type Company, type CompanyPlan } from "../../../db";
import { AppError } from "../../lib/AppError";
import { stripe, STRIPE_PRICE_IDS } from "../../lib/stripe";
import { assertCompanyOwner, getCompanyById, type RequestingUser } from "../companies/companies.queries";
import type { CreateCheckoutSessionInput, CreatePortalSessionInput } from "./billing.schemas";

// Stripe Checkout / the Billing Portal redirect back into the app via one of
// two fixed URLs, chosen by the client's declared platform — never a
// client-supplied URL, so this can't be abused as an open redirect. Native
// uses app.json's "mobile://" deep link scheme; web uses the same origin
// this Expo web app is actually served from (APP_DOMAIN, already the
// canonical env var for that — see its use in app.ts's CORS allowlist).
function billingReturnUrl(platform: "web" | "native" | undefined): string {
  if (platform === "web") {
    return `${process.env.APP_DOMAIN ?? "http://localhost:8081"}/billing`;
  }
  return "mobile://billing";
}

const PRICE_ID_TO_PLAN: Record<string, CompanyPlan> = {
  [STRIPE_PRICE_IDS.basic]: "basic",
  [STRIPE_PRICE_IDS.pro]: "pro",
};

function currentPeriodEndOf(subscription: Stripe.Subscription): Date | null {
  const item = subscription.items.data[0];
  return item ? new Date(item.current_period_end * 1000) : null;
}

async function getOrCreateStripeCustomer(company: Company, userEmail: string): Promise<string> {
  if (company.stripeCustomerId) return company.stripeCustomerId;

  const customer = await stripe.customers.create({
    email: userEmail,
    metadata: { companyId: company.id },
  });

  await db
    .update(companies)
    .set({ stripeCustomerId: customer.id })
    .where(eq(companies.id, company.id));

  return customer.id;
}

export async function createCheckoutSession(
  user: RequestingUser,
  userEmail: string,
  input: CreateCheckoutSessionInput
): Promise<{ url: string }> {
  const company = await getCompanyById(input.companyId);
  await assertCompanyOwner(company, user);

  const customerId = await getOrCreateStripeCustomer(company, userEmail);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: STRIPE_PRICE_IDS[input.plan], quantity: 1 }],
    success_url: billingReturnUrl(input.platform),
    cancel_url: billingReturnUrl(input.platform),
    metadata: { companyId: company.id, plan: input.plan },
  });

  if (!session.url) throw new AppError(500, "Failed to create checkout session");
  return { url: session.url };
}

export async function createPortalSession(
  user: RequestingUser,
  input: CreatePortalSessionInput
): Promise<{ url: string }> {
  const company = await getCompanyById(input.companyId);
  await assertCompanyOwner(company, user);

  if (!company.stripeCustomerId) {
    throw new AppError(400, "No billing account for this company yet");
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: company.stripeCustomerId,
    return_url: billingReturnUrl(input.platform),
  });

  return { url: session.url };
}

export async function applyCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const companyId = session.metadata?.companyId;
  const plan = session.metadata?.plan as CompanyPlan | undefined;
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription?.id;

  if (!companyId || !plan || !subscriptionId) {
    console.error("checkout.session.completed missing companyId/plan/subscription", session.id);
    return;
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  await db
    .update(companies)
    .set({
      planTier: plan,
      stripeSubscriptionId: subscription.id,
      stripeSubscriptionStatus: subscription.status,
      currentPeriodEnd: currentPeriodEndOf(subscription),
      // Stripe now owns the plan: the Transfermóvil expiry job must leave it alone.
      planSource: "stripe",
      planExpiresAt: null,
      planReminderSentAt: null,
    })
    .where(eq(companies.id, companyId));
}

async function resolveCompanyIdFromCustomer(
  customer: Stripe.Subscription["customer"]
): Promise<string | undefined> {
  const customerId = typeof customer === "string" ? customer : customer.id;
  const stripeCustomer = await stripe.customers.retrieve(customerId);
  if (stripeCustomer.deleted) return undefined;
  return stripeCustomer.metadata?.companyId;
}

export async function applySubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  const companyId = await resolveCompanyIdFromCustomer(subscription.customer);
  if (!companyId) {
    console.error("customer.subscription.updated: no companyId on customer metadata", subscription.id);
    return;
  }

  const priceId = subscription.items.data[0]?.price.id;
  const inactiveStatuses = new Set(["canceled", "unpaid", "incomplete_expired"]);
  const planTier: CompanyPlan = inactiveStatuses.has(subscription.status)
    ? "free"
    : (priceId && PRICE_ID_TO_PLAN[priceId]) || "free";

  await db
    .update(companies)
    .set({
      planTier,
      stripeSubscriptionStatus: subscription.status,
      currentPeriodEnd: currentPeriodEndOf(subscription),
      planSource: planTier === "free" ? "none" : "stripe",
      planExpiresAt: null,
    })
    .where(eq(companies.id, companyId));
}

export async function applySubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const companyId = await resolveCompanyIdFromCustomer(subscription.customer);
  if (!companyId) {
    console.error("customer.subscription.deleted: no companyId on customer metadata", subscription.id);
    return;
  }

  await db
    .update(companies)
    .set({ planTier: "free", stripeSubscriptionStatus: "canceled", planSource: "none", planExpiresAt: null })
    .where(eq(companies.id, companyId));
}

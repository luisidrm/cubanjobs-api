import Stripe from "stripe";

// Only fail loudly in production — importing this module (via app.ts's
// unconditional billing route mount) must not crash local dev for everyone
// else just because Stripe hasn't been configured yet. Mirrors src/lib/minio.ts.
if (
  process.env.NODE_ENV === "production" &&
  (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID_BASIC || !process.env.STRIPE_PRICE_ID_PRO)
) {
  throw new Error(
    "STRIPE_SECRET_KEY, STRIPE_PRICE_ID_BASIC, and STRIPE_PRICE_ID_PRO must be set in production"
  );
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "sk_test_placeholder");

export const STRIPE_PRICE_IDS: Record<"basic" | "pro", string> = {
  basic: process.env.STRIPE_PRICE_ID_BASIC ?? "",
  pro: process.env.STRIPE_PRICE_ID_PRO ?? "",
};

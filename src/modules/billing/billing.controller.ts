import type { Request, Response } from "express";
import type Stripe from "stripe";
import { stripe } from "../../lib/stripe";
import { AppError } from "../../lib/AppError";
import {
  createCheckoutSession,
  createPortalSession,
  applyCheckoutCompleted,
  applySubscriptionUpdated,
  applySubscriptionDeleted,
} from "./billing.queries";

export async function createCheckoutSessionHandler(req: Request, res: Response) {
  const data = await createCheckoutSession(req.user!, req.user!.email, req.body);
  res.status(200).json({ success: true, data });
}

export async function createPortalSessionHandler(req: Request, res: Response) {
  const data = await createPortalSession(req.user!, req.body);
  res.status(200).json({ success: true, data });
}

/**
 * Stripe webhook — req.body is the raw request Buffer (see billing.webhookRoutes.ts,
 * mounted with express.raw() BEFORE app.ts's global express.json()), since
 * signature verification needs the exact bytes Stripe signed, not a
 * re-serialized parsed object.
 */
export async function handleWebhook(req: Request, res: Response) {
  const signature = req.headers["stripe-signature"];
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body as Buffer,
      signature as string,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    throw new AppError(400, `Webhook signature verification failed: ${(err as Error).message}`);
  }

  switch (event.type) {
    case "checkout.session.completed":
      await applyCheckoutCompleted(event.data.object);
      break;
    case "customer.subscription.updated":
      await applySubscriptionUpdated(event.data.object);
      break;
    case "customer.subscription.deleted":
      await applySubscriptionDeleted(event.data.object);
      break;
    default:
      break;
  }

  res.status(200).json({ received: true });
}

import { Router } from "express";
import { createCheckoutSessionHandler, createPortalSessionHandler } from "./billing.controller";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createCheckoutSessionSchema, createPortalSessionSchema } from "./billing.schemas";

const router = Router();

// Stripe is hidden for now: the endpoints answer 404 until STRIPE_ENABLED=true.
router.use((_req, res, next) => {
  if (process.env.STRIPE_ENABLED !== "true") {
    res.status(404).json({ success: false, message: "Not found" });
    return;
  }
  next();
});

router.post(
  "/checkout-session",
  requireAuth,
  requireRole("employer"),
  validateBody(createCheckoutSessionSchema),
  createCheckoutSessionHandler
);

router.post(
  "/portal-session",
  requireAuth,
  requireRole("employer"),
  validateBody(createPortalSessionSchema),
  createPortalSessionHandler
);

export default router;

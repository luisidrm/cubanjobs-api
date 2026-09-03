import { Router } from "express";
import { createCheckoutSessionHandler, createPortalSessionHandler } from "./billing.controller";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { createCheckoutSessionSchema, createPortalSessionSchema } from "./billing.schemas";

const router = Router();

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

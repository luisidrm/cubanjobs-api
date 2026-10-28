import { Router } from "express";
import { z } from "zod";
import { validateQuery, getValidatedQuery } from "../../middleware/validate";
import { requireAuth } from "../../middleware/auth";
import { getActivePlans, getPaymentDestination } from "./plans.queries";

const router = Router();

const plansQuerySchema = z.object({
  audience: z.enum(["employee", "employer"]).optional(),
});

// Public: prices are not secret and the marketing screens need them signed out.
router.get("/", validateQuery(plansQuerySchema), async (req, res) => {
  const { audience } = getValidatedQuery<z.infer<typeof plansQuerySchema>>(req);
  res.status(200).json({ success: true, data: await getActivePlans(audience) });
});

// Signed-in only: the Transfermóvil destination is shown just to people about to pay.
router.get("/payment-destination", requireAuth, async (_req, res) => {
  res.status(200).json({ success: true, data: await getPaymentDestination() });
});

export default router;

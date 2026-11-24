import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { reportLimiter } from "../../middleware/rateLimit";
import { validateBody } from "../../middleware/validate";
import { createReport } from "./reports.queries";
import { createReportSchema, type CreateReportInput } from "./reports.schemas";

const router = Router();

// Any signed-in user can report; the limiter and the one-per-item rule keep it from being used as a weapon.
router.post("/", requireAuth, reportLimiter, validateBody(createReportSchema), async (req, res) => {
  const { alreadyReported } = await createReport(req.user!.id, req.body as CreateReportInput);
  res.status(alreadyReported ? 200 : 201).json({ success: true, data: { alreadyReported } });
});

export default router;

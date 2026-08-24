import { Router } from "express";
import { save, unsave, getMine } from "./savedJobs.controller";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateParams } from "../../middleware/validate";
import { savedJobParamSchema } from "./savedJobs.schemas";

const router = Router();

router.get("/", requireAuth, requireRole("employee"), getMine);
router.post(
  "/:jobId",
  requireAuth,
  requireRole("employee"),
  validateParams(savedJobParamSchema),
  save
);
router.delete(
  "/:jobId",
  requireAuth,
  requireRole("employee"),
  validateParams(savedJobParamSchema),
  unsave
);

export default router;
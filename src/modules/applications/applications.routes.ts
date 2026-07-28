import { Router } from "express";
import {
  apply,
  getMine,
  getById,
  updateStatus,
  updateNotes,
  withdraw,
} from "./applications.controller";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody, validateParams } from "../../middleware/validate";
import {
  applyToJobSchema,
  updateApplicationStatusSchema,
  updateApplicationNotesSchema,
  applicationIdParamSchema,
} from "./applications.schemas";

const router = Router();

// Employees only: apply, view own applications, withdraw
router.post(
  "/",
  requireAuth,
  requireRole("employee"),
  validateBody(applyToJobSchema),
  apply
);

router.get("/mine", requireAuth, requireRole("employee"), getMine);

router.patch(
  "/:id/withdraw",
  requireAuth,
  requireRole("employee"),
  validateParams(applicationIdParamSchema),
  withdraw
);

// Shared: applicant (own), employer (owns job), or admin — checked inside the query layer
router.get(
  "/:id",
  requireAuth,
  validateParams(applicationIdParamSchema),
  getById
);

// Employer/admin only: manage status and notes
router.patch(
  "/:id/status",
  requireAuth,
  requireRole("employer", "admin"),
  validateParams(applicationIdParamSchema),
  validateBody(updateApplicationStatusSchema),
  updateStatus
);

router.patch(
  "/:id/notes",
  requireAuth,
  requireRole("employer", "admin"),
  validateParams(applicationIdParamSchema),
  validateBody(updateApplicationNotesSchema),
  updateNotes
);

export default router;
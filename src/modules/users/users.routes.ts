import { Router } from "express";
import {
  getMe,
  getProfile,
  updateProfile,
  addMySkill,
  removeMySkill,
  deleteMe,
  searchWorkersHandler,
  getSkillsList,
  completeOnboardingHandler,
} from "./users.controller";
import { requireAuth, requireRole } from "../../middleware/auth";
import { requireSearchAccess } from "../../middleware/plan";
import { validateBody, validateParams, validateQuery } from "../../middleware/validate";
import {
  updateUserSchema,
  userIdParamSchema,
  addSkillSchema,
  skillIdParamSchema,
  workerSearchQuerySchema,
} from "./users.schemas";

const router = Router();

// Must come before "/:id" — otherwise these would be captured by the
// dynamic param route and fail uuid validation instead of resolving here.
router.get("/me", requireAuth, getMe);
router.delete("/me", requireAuth, deleteMe);
router.post("/me/onboarding/complete", requireAuth, completeOnboardingHandler);
router.post("/me/skills", requireAuth, validateBody(addSkillSchema), addMySkill);
router.delete(
  "/me/skills/:skillId",
  requireAuth,
  validateParams(skillIdParamSchema),
  removeMySkill
);

// Employer-only worker directory
router.get(
  "/workers",
  requireAuth,
  requireRole("employer"),
  requireSearchAccess,
  validateQuery(workerSearchQuerySchema),
  searchWorkersHandler
);
router.get("/skills", requireAuth, requireRole("employer"), getSkillsList);

router.get("/:id", validateParams(userIdParamSchema), getProfile);

router.patch(
  "/:id",
  requireAuth,
  validateParams(userIdParamSchema),
  validateBody(updateUserSchema),
  updateProfile
);

export default router;

import { Router } from "express";
import { create, update, remove } from "./workExperience.controller";
import { requireAuth } from "../../middleware/auth";
import { validateBody, validateParams } from "../../middleware/validate";
import {
  createExperienceSchema,
  updateExperienceSchema,
  experienceIdParamSchema,
} from "./workExperience.schemas";

const router = Router();

router.post("/", requireAuth, validateBody(createExperienceSchema), create);
router.patch(
  "/:id",
  requireAuth,
  validateParams(experienceIdParamSchema),
  validateBody(updateExperienceSchema),
  update
);
router.delete("/:id", requireAuth, validateParams(experienceIdParamSchema), remove);

export default router;

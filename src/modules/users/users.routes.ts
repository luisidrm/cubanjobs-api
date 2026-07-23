import { Router } from "express";
import { getProfile, updateProfile } from "./users.controller";
import { requireAuth } from "../../middleware/auth";
import { validateBody, validateParams } from "../../middleware/validate";
import { updateUserSchema, userIdParamSchema } from "./users.schemas";

const router = Router();

router.get("/:id", validateParams(userIdParamSchema), getProfile);

router.patch(
  "/:id",
  requireAuth,
  validateParams(userIdParamSchema),
  validateBody(updateUserSchema),
  updateProfile
);

export default router;

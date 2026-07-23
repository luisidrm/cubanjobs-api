import { Router } from "express";
import { search, getById, getByCompany, create, update, remove } from "./jobs.controller";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody, validateParams, validateQuery } from "../../middleware/validate";
import {
  createJobSchema,
  updateJobSchema,
  jobIdParamSchema,
  jobSearchQuerySchema,
} from "./jobs.schemas";

const router = Router();

// Public routes
router.get("/", validateQuery(jobSearchQuerySchema), search);
router.get("/:id", validateParams(jobIdParamSchema), getById);

// Employer-only: see all jobs for a company (including drafts and closed)
router.get(
  "/company/:id",
  requireAuth,
  requireRole("employer"),
  validateParams(jobIdParamSchema),
  getByCompany
);

// Employer-only: create, update, delete
router.post(
  "/",
  requireAuth,
  requireRole("employer"),
  validateBody(createJobSchema),
  create
);

router.patch(
  "/:id",
  requireAuth,
  requireRole("employer"),
  validateParams(jobIdParamSchema),
  validateBody(updateJobSchema),
  update
);

router.delete(
  "/:id",
  requireAuth,
  requireRole("employer"),
  validateParams(jobIdParamSchema),
  remove
);

export default router;

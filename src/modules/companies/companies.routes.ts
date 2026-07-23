import { Router } from "express";
import { create, getById, getMyCompanies, update, remove } from "./companies.controller";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody, validateParams } from "../../middleware/validate";
import { createCompanySchema, updateCompanySchema, companyIdParamSchema } from "./companies.schemas";

const router = Router();

// Any authenticated employer can list their own companies
router.get("/my", requireAuth, requireRole("employer"), getMyCompanies);

// Public: anyone can view a company profile
router.get("/:id", validateParams(companyIdParamSchema), getById);

// Employers only: create, update, delete
router.post("/", requireAuth, requireRole("employer"), validateBody(createCompanySchema), create);

router.patch(
  "/:id",
  requireAuth,
  requireRole("employer"),
  validateParams(companyIdParamSchema),
  validateBody(updateCompanySchema),
  update
);

router.delete(
  "/:id",
  requireAuth,
  requireRole("employer"),
  validateParams(companyIdParamSchema),
  remove
);

export default router;

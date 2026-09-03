import { Router } from "express";
import {
  searchCompaniesHandler,
  verifyCompanyHandler,
  updateUserRoleHandler,
  userLookupHandler,
  deleteOrphanHandler,
} from "./admin.controller";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody, validateParams, validateQuery } from "../../middleware/validate";
import {
  verifyCompanySchema,
  updateUserRoleSchema,
  companyIdParamSchema,
  userIdParamSchema,
  orphanParamSchema,
  userLookupQuerySchema,
  companySearchQuerySchema,
} from "./admin.schemas";

const router = Router();

router.use(requireAuth, requireRole("admin"));

router.get("/companies/search", validateQuery(companySearchQuerySchema), searchCompaniesHandler);

router.patch(
  "/companies/:id/verify",
  validateParams(companyIdParamSchema),
  validateBody(verifyCompanySchema),
  verifyCompanyHandler
);

router.patch(
  "/users/:id/role",
  validateParams(userIdParamSchema),
  validateBody(updateUserRoleSchema),
  updateUserRoleHandler
);

router.get("/users/lookup", validateQuery(userLookupQuerySchema), userLookupHandler);

router.delete(
  "/users/orphan/:supertokensUserId",
  validateParams(orphanParamSchema),
  deleteOrphanHandler
);

export default router;

import { Router } from "express";
import {
  searchCompaniesHandler,
  verifyCompanyHandler,
  updateUserRoleHandler,
  userLookupHandler,
  deleteOrphanHandler,
} from "./admin.controller";
import { requireAuth, requireRole } from "../../middleware/auth";
import adminPaymentsRoutes from "./adminPayments.routes";
import adminReportsRoutes from "./adminReports.routes";
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

// Payments queue, manual plans, prices and payment settings.
router.use(adminPaymentsRoutes);

// Reports queue.
router.use(adminReportsRoutes);

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

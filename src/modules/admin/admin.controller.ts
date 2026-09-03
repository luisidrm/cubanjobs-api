import type { Request, Response } from "express";
import { getValidatedParams, getValidatedQuery } from "../../middleware/validate";
import {
  searchCompaniesByName,
  verifyCompany,
  updateUserRole,
  lookupUserByEmail,
  deleteOrphanedSupertokensUser,
} from "./admin.queries";
import type { z } from "zod";
import type {
  companyIdParamSchema,
  userIdParamSchema,
  orphanParamSchema,
  userLookupQuerySchema,
  companySearchQuerySchema,
} from "./admin.schemas";

type CompanyIdParams = z.infer<typeof companyIdParamSchema>;
type UserIdParams = z.infer<typeof userIdParamSchema>;
type OrphanParams = z.infer<typeof orphanParamSchema>;
type UserLookupQuery = z.infer<typeof userLookupQuerySchema>;
type CompanySearchQuery = z.infer<typeof companySearchQuerySchema>;

export async function searchCompaniesHandler(req: Request, res: Response) {
  const { q } = getValidatedQuery<CompanySearchQuery>(req);
  const results = await searchCompaniesByName(q);
  res.status(200).json({ success: true, data: results });
}

export async function verifyCompanyHandler(req: Request, res: Response) {
  const { id } = getValidatedParams<CompanyIdParams>(req);
  const company = await verifyCompany(id, req.body.isVerified);
  res.status(200).json({ success: true, data: company });
}

export async function updateUserRoleHandler(req: Request, res: Response) {
  const { id } = getValidatedParams<UserIdParams>(req);
  const user = await updateUserRole(id, req.body.role);
  res.status(200).json({ success: true, data: user });
}

export async function userLookupHandler(req: Request, res: Response) {
  const { email } = getValidatedQuery<UserLookupQuery>(req);
  const result = await lookupUserByEmail(email);
  res.status(200).json({ success: true, data: result });
}

export async function deleteOrphanHandler(req: Request, res: Response) {
  const { supertokensUserId } = getValidatedParams<OrphanParams>(req);
  await deleteOrphanedSupertokensUser(supertokensUserId);
  res.status(204).send();
}

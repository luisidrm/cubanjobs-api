import type { Request, Response } from "express";
import {
  createCompany,
  getCompanyById,
  getCompaniesByOwner,
  updateCompany,
  deleteCompany,
} from "./companies.queries";
import { getValidatedParams } from "../../middleware/validate";
import type { z } from "zod";
import type { companyIdParamSchema } from "./companies.schemas";

type CompanyIdParams = z.infer<typeof companyIdParamSchema>;

export async function create(req: Request, res: Response) {
  const company = await createCompany(req.user!.id, req.body);
  res.status(201).json({ success: true, data: company });
}

export async function getById(req: Request, res: Response) {
  const { id } = getValidatedParams<CompanyIdParams>(req);
  const company = await getCompanyById(id);
  res.status(200).json({ success: true, data: company });
}

export async function getMyCompanies(req: Request, res: Response) {
  const data = await getCompaniesByOwner(req.user!.id);
  res.status(200).json({ success: true, data });
}

export async function update(req: Request, res: Response) {
  const { id } = getValidatedParams<CompanyIdParams>(req);
  const company = await updateCompany(req.user!, id, req.body);
  res.status(200).json({ success: true, data: company });
}

export async function remove(req: Request, res: Response) {
  const { id } = getValidatedParams<CompanyIdParams>(req);
  await deleteCompany(req.user!, id);
  res.status(204).send();
}
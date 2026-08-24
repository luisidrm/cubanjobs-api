import type { Request, Response } from "express";
import type { z } from "zod";
import {
  searchJobs,
  getJobWithCompanyById,
  incrementViewCount,
  getJobsByCompany,
  createJob,
  updateJob,
  deleteJob,
  type JobSearchFilters,
} from "./jobs.queries";
import { getValidatedParams, getValidatedQuery } from "../../middleware/validate";
import type { jobIdParamSchema, jobSearchQuerySchema } from "./jobs.schemas";

type JobIdParams = z.infer<typeof jobIdParamSchema>;
type JobSearchQuery = z.infer<typeof jobSearchQuerySchema>;

export async function search(req: Request, res: Response) {
  const filters = getValidatedQuery<JobSearchQuery>(req);
  const jobs = await searchJobs(filters as JobSearchFilters);
  res.status(200).json({ success: true, data: jobs });
}

export async function getById(req: Request, res: Response) {
  const { id } = getValidatedParams<JobIdParams>(req);
  const job = await getJobWithCompanyById(id);
  incrementViewCount(id).catch(() => null);
  res.status(200).json({ success: true, data: job });
}

/** Employer/admin-only: list all jobs for a company regardless of status */
export async function getByCompany(req: Request, res: Response) {
  const { id } = getValidatedParams<JobIdParams>(req);
  const jobs = await getJobsByCompany(req.user!, id);
  res.status(200).json({ success: true, data: jobs });
}

export async function create(req: Request, res: Response) {
  const job = await createJob(req.user!, req.body);
  res.status(201).json({ success: true, data: job });
}

export async function update(req: Request, res: Response) {
  const { id } = getValidatedParams<JobIdParams>(req);
  const job = await updateJob(req.user!, id, req.body);
  res.status(200).json({ success: true, data: job });
}

export async function remove(req: Request, res: Response) {
  const { id } = getValidatedParams<JobIdParams>(req);
  await deleteJob(req.user!, id);
  res.status(204).send();
}
import type { Request, Response } from "express";
import type { z } from "zod";
import {
  searchJobs,
  getJobById,
  incrementViewCount,
  getJobsByCompany,
  createJob,
  updateJob,
  deleteJob,
  type JobSearchFilters,
} from "./jobs.queries";
import { getValidatedParams } from "../../middleware/validate";
import type { jobIdParamSchema } from "./jobs.schemas";

type JobIdParams = z.infer<typeof jobIdParamSchema>;

export async function search(req: Request, res: Response) {
  const filters = req.query as unknown as JobSearchFilters;
  const jobs = await searchJobs(filters);
  res.status(200).json({ success: true, data: jobs });
}

export async function getById(req: Request, res: Response) {
  const { id } = getValidatedParams<JobIdParams>(req);
  const job = await getJobById(id);
  // Increment view count asynchronously — don't let it slow down the response
  incrementViewCount(id).catch(() => null);
  res.status(200).json({ success: true, data: job });
}

/** Employer-only: list all jobs for a company regardless of status */
export async function getByCompany(req: Request, res: Response) {
  const { id } = getValidatedParams<JobIdParams>(req);
  const jobs = await getJobsByCompany(id);
  res.status(200).json({ success: true, data: jobs });
}

export async function create(req: Request, res: Response) {
  const job = await createJob(req.user!.id, req.body);
  res.status(201).json({ success: true, data: job });
}

export async function update(req: Request, res: Response) {
  const { id } = getValidatedParams<JobIdParams>(req);
  const job = await updateJob(req.user!.id, id, req.body);
  res.status(200).json({ success: true, data: job });
}

export async function remove(req: Request, res: Response) {
  const { id } = getValidatedParams<JobIdParams>(req);
  await deleteJob(req.user!.id, id);
  res.status(204).send();
}

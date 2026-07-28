import type { Request, Response } from "express";
import type { z } from "zod";
import {
  applyToJob,
  getMyApplications,
  assertCanAccessApplication,
  getApplicationsForJob,
  updateApplicationStatus,
  updateApplicationNotes,
  withdrawApplication,
} from "./applications.queries";
import { getValidatedParams } from "../../middleware/validate";
import type {
  applicationIdParamSchema,
  jobIdParamSchema,
  ApplyToJobInput,
  UpdateApplicationStatusInput,
  UpdateApplicationNotesInput,
} from "./applications.schemas";

type ApplicationIdParams = z.infer<typeof applicationIdParamSchema>;
type JobIdParams = z.infer<typeof jobIdParamSchema>;

export async function apply(req: Request, res: Response) {
  const application = await applyToJob(req.user!.id, req.body as ApplyToJobInput);
  res.status(201).json({ success: true, data: application });
}

export async function getMine(req: Request, res: Response) {
  const data = await getMyApplications(req.user!.id);
  res.status(200).json({ success: true, data });
}

export async function getById(req: Request, res: Response) {
  const { id } = getValidatedParams<ApplicationIdParams>(req);
  const application = await assertCanAccessApplication(req.user!, id);
  res.status(200).json({ success: true, data: application });
}

/** GET /jobs/:id/applications — employer/admin view of applicants for one job */
export async function getForJob(req: Request, res: Response) {
  const { id } = getValidatedParams<JobIdParams>(req);
  const data = await getApplicationsForJob(req.user!, id);
  res.status(200).json({ success: true, data });
}

export async function updateStatus(req: Request, res: Response) {
  const { id } = getValidatedParams<ApplicationIdParams>(req);
  const application = await updateApplicationStatus(
    req.user!,
    id,
    req.body as UpdateApplicationStatusInput
  );
  res.status(200).json({ success: true, data: application });
}

export async function updateNotes(req: Request, res: Response) {
  const { id } = getValidatedParams<ApplicationIdParams>(req);
  const application = await updateApplicationNotes(
    req.user!,
    id,
    req.body as UpdateApplicationNotesInput
  );
  res.status(200).json({ success: true, data: application });
}

export async function withdraw(req: Request, res: Response) {
  const { id } = getValidatedParams<ApplicationIdParams>(req);
  const application = await withdrawApplication(req.user!, id);
  res.status(200).json({ success: true, data: application });
}
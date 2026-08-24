import type { Request, Response } from "express";
import { saveJob, unsaveJob, getMySavedJobs } from "./savedJobs.queries";
import { getValidatedParams } from "../../middleware/validate";
import type { SavedJobParams } from "./savedJobs.schemas";

export async function save(req: Request, res: Response) {
  const { jobId } = getValidatedParams<SavedJobParams>(req);
  await saveJob(req.user!.id, jobId);
  res.status(204).send();
}

export async function unsave(req: Request, res: Response) {
  const { jobId } = getValidatedParams<SavedJobParams>(req);
  await unsaveJob(req.user!.id, jobId);
  res.status(204).send();
}

export async function getMine(req: Request, res: Response) {
  const data = await getMySavedJobs(req.user!.id);
  res.status(200).json({ success: true, data });
}
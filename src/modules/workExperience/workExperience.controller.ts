import type { Request, Response } from "express";
import { addExperience, updateExperience, deleteExperience } from "./workExperience.queries";
import { getValidatedParams } from "../../middleware/validate";
import type { ExperienceIdParams } from "./workExperience.schemas";

export async function create(req: Request, res: Response) {
  const row = await addExperience(req.user!.id, req.body);
  res.status(201).json({ success: true, data: row });
}

export async function update(req: Request, res: Response) {
  const { id } = getValidatedParams<ExperienceIdParams>(req);
  const row = await updateExperience(id, req.user!.id, req.body);
  res.status(200).json({ success: true, data: row });
}

export async function remove(req: Request, res: Response) {
  const { id } = getValidatedParams<ExperienceIdParams>(req);
  await deleteExperience(id, req.user!.id);
  res.status(204).send();
}

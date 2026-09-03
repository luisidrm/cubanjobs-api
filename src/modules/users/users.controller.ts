import type { Request, Response } from "express";
import {
  getUserById,
  updateUser,
  toPublicUser,
  getMyProfile,
  addSkill,
  removeSkill,
  deleteOwnAccount,
  searchWorkers,
  getDistinctSkills,
  completeOnboarding,
} from "./users.queries";
import { getValidatedParams, getValidatedQuery } from "../../middleware/validate";
import { AppError } from "../../lib/AppError";
import type { z } from "zod";
import type { userIdParamSchema, skillIdParamSchema, workerSearchQuerySchema } from "./users.schemas";

type UserIdParams = z.infer<typeof userIdParamSchema>;
type SkillIdParams = z.infer<typeof skillIdParamSchema>;
type WorkerSearchQuery = z.infer<typeof workerSearchQuerySchema>;

export async function getMe(req: Request, res: Response) {
  const profile = await getMyProfile(req.user!.id);
  res.status(200).json({ success: true, data: profile });
}

export async function getProfile(req: Request, res: Response) {
  const { id } = getValidatedParams<UserIdParams>(req);
  const user = await getUserById(id);
  res.status(200).json({ success: true, data: await toPublicUser(user) });
}

export async function addMySkill(req: Request, res: Response) {
  const row = await addSkill(req.user!.id, req.body);
  res.status(201).json({ success: true, data: row });
}

export async function removeMySkill(req: Request, res: Response) {
  const { skillId } = getValidatedParams<SkillIdParams>(req);
  await removeSkill(req.user!.id, skillId);
  res.status(204).send();
}

export async function deleteMe(req: Request, res: Response) {
  const user = await getUserById(req.user!.id);
  await deleteOwnAccount(user);
  res.status(204).send();
}

export async function completeOnboardingHandler(req: Request, res: Response) {
  await completeOnboarding(req.user!.id);
  res.status(204).send();
}

export async function searchWorkersHandler(req: Request, res: Response) {
  const filters = getValidatedQuery<WorkerSearchQuery>(req);
  const data = await searchWorkers(filters);
  res.status(200).json({ success: true, data });
}

export async function getSkillsList(_req: Request, res: Response) {
  const data = await getDistinctSkills();
  res.status(200).json({ success: true, data });
}

export async function updateProfile(req: Request, res: Response) {
  const { id } = getValidatedParams<UserIdParams>(req);
  if (req.user!.id !== id && req.user!.role !== "admin") {
    throw new AppError(403, "You can only update your own profile");
  }
  const user = await updateUser(id, req.body);
  // Owner/admin gets the full record back, unlike the redacted public GET.
  res.status(200).json({ success: true, data: user });
}

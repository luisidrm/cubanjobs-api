import type { Request, Response } from "express";
import { getUserById, updateUser, toPublicUser } from "./users.queries";
import { getValidatedParams } from "../../middleware/validate";
import type { z } from "zod";
import type { userIdParamSchema } from "./users.schemas";

type UserIdParams = z.infer<typeof userIdParamSchema>;

export async function getProfile(req: Request, res: Response) {
  const { id } = getValidatedParams<UserIdParams>(req);
  const user = await getUserById(id);
  res.status(200).json({ success: true, data: toPublicUser(user) });
}

export async function updateProfile(req: Request, res: Response) {
  const { id } = getValidatedParams<UserIdParams>(req);
  const user = await updateUser(id, req.body);
  res.status(200).json({ success: true, data: toPublicUser(user) });
}

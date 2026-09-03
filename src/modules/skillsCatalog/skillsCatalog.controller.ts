import type { Request, Response } from "express";
import { listSkillsCatalog } from "./skillsCatalog.queries";

export async function getSkillsCatalog(_req: Request, res: Response) {
  const data = await listSkillsCatalog();
  res.status(200).json({ success: true, data });
}

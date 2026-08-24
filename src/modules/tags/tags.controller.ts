import type { Request, Response } from "express";
import { listTags } from "./tags.queries";

export async function getTags(_req: Request, res: Response) {
  const data = await listTags();
  res.status(200).json({ success: true, data });
}

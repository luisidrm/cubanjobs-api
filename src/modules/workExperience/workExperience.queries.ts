import { and, eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { workExperience, type WorkExperience } from "../../../db";
import { AppError } from "../../lib/AppError";
import type { CreateExperienceInput, UpdateExperienceInput } from "./workExperience.schemas";

export async function addExperience(
  userId: string,
  input: CreateExperienceInput
): Promise<WorkExperience> {
  const [row] = await db
    .insert(workExperience)
    .values({ userId, ...input })
    .returning();
  if (!row) throw new AppError(500, "Failed to add work experience");
  return row;
}

/** Throws 404 if the entry doesn't exist or belongs to a different user. */
async function getOwnedExperience(id: string, userId: string): Promise<WorkExperience> {
  const [row] = await db
    .select()
    .from(workExperience)
    .where(and(eq(workExperience.id, id), eq(workExperience.userId, userId)));
  if (!row) throw new AppError(404, "Work experience entry not found");
  return row;
}

export async function updateExperience(
  id: string,
  userId: string,
  input: UpdateExperienceInput
): Promise<WorkExperience> {
  await getOwnedExperience(id, userId);
  const [row] = await db
    .update(workExperience)
    .set(input)
    .where(eq(workExperience.id, id))
    .returning();
  if (!row) throw new AppError(500, "Failed to update work experience");
  return row;
}

export async function deleteExperience(id: string, userId: string): Promise<void> {
  await getOwnedExperience(id, userId);
  await db.delete(workExperience).where(eq(workExperience.id, id));
}

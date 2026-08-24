import { z } from "zod";

export const createExperienceSchema = z.object({
  title: z.string().min(1).max(150),
  organization: z.string().max(150).optional(),
  description: z.string().optional(),
  contact: z.string().max(255).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

export const updateExperienceSchema = createExperienceSchema.partial();

export const experienceIdParamSchema = z.object({
  id: z.uuidv4(),
});

export type CreateExperienceInput = z.infer<typeof createExperienceSchema>;
export type UpdateExperienceInput = z.infer<typeof updateExperienceSchema>;
export type ExperienceIdParams = z.infer<typeof experienceIdParamSchema>;

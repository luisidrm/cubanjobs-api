import { z } from "zod";

export const updateUserSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  phone: z.string().max(30).optional(),
  bio: z.string().optional(),
  location: z.string().max(255).optional(),
  linkedinUrl: z.string().url().max(500).optional(),
  expoPushToken: z.string().nullable().optional(),
});

export const userIdParamSchema = z.object({
  id: z.uuidv4(),
});

export const addSkillSchema = z.object({
  skill: z.string().min(1).max(100),
  yearsExperience: z.number().int().min(0).max(80).optional(),
});

export const skillIdParamSchema = z.object({
  skillId: z.uuidv4(),
});

export const workerSearchQuerySchema = z.object({
  q: z.string().optional(),
  skills: z
    .string()
    .optional()
    .transform((val) => (val ? val.split(",") : undefined)),
  location: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UserIdParams = z.infer<typeof userIdParamSchema>;
export type AddSkillInput = z.infer<typeof addSkillSchema>;
export type SkillIdParams = z.infer<typeof skillIdParamSchema>;
export type WorkerSearchQuery = z.infer<typeof workerSearchQuerySchema>;

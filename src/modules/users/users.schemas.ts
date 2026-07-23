import { z } from "zod";

export const updateUserSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  phone: z.string().max(30).optional(),
  bio: z.string().optional(),
  location: z.string().max(255).optional(),
});

export const userIdParamSchema = z.object({
  id: z.uuidv4(),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UserIdParams = z.infer<typeof userIdParamSchema>;

import { z } from "zod";
import { userRoleEnum } from "../../../db/schema/users";

export const verifyCompanySchema = z.object({
  isVerified: z.boolean(),
});

export const updateUserRoleSchema = z.object({
  role: z.enum(userRoleEnum.enumValues),
});

export const companyIdParamSchema = z.object({
  id: z.uuidv4(),
});

export const userIdParamSchema = z.object({
  id: z.uuidv4(),
});

export const orphanParamSchema = z.object({
  supertokensUserId: z.string().min(1),
});

export const userLookupQuerySchema = z.object({
  email: z.email(),
});

export const companySearchQuerySchema = z.object({
  q: z.string().min(1),
});

export type VerifyCompanyInput = z.infer<typeof verifyCompanySchema>;
export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;

import { z } from "zod";

export const jobTypeValues = [
  "full_time",
  "part_time",
  "contract",
  "freelance",
  "internship",
] as const;

export const jobStatusValues = ["draft", "active", "closed", "expired"] as const;

export const currencyValues = ["CUP", "MLC", "USD"] as const;

export const createJobSchema = z.object({
  companyId: z.uuidv4(),
  title: z.string().min(1).max(255),
  description: z.string().min(1),
  salaryMin: z.number().int().nonnegative().optional(),
  salaryMax: z.number().int().nonnegative().optional(),
  currency: z.enum(currencyValues).optional(),
  location: z.string().max(255).optional(),
  jobType: z.enum(jobTypeValues).optional(),
  isRemote: z.boolean().optional(),
  status: z.enum(jobStatusValues).optional(),
  expiresAt: z.string().datetime().optional(),
});

export const updateJobSchema = createJobSchema
  .partial()
  .omit({ companyId: true });

export const jobIdParamSchema = z.object({
  id: z.uuidv4(),
});

export const jobSearchQuerySchema = z.object({
  q: z.string().optional(),
  isRemote: z.coerce.boolean().optional(),
  location: z.string().optional(),
  currency: z.enum(currencyValues).optional(),
  jobType: z.enum(jobTypeValues).optional(),
  tagIds: z
    .string()
    .optional()
    .transform((val) => (val ? val.split(",") : undefined)),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

export type CreateJobInput = z.infer<typeof createJobSchema>;
export type UpdateJobInput = z.infer<typeof updateJobSchema>;

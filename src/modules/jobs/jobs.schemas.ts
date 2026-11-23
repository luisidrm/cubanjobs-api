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

// A phone number as people type it: "+53 5555 5555", "(53) 55555555", "55555555".
// Empty means "none" (null clears it on update).
const whatsappNumber = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .pipe(z.string().regex(/^\+?[0-9 ()-]{6,20}$/,"Enter a valid phone number").nullable())
  .nullable();

export const createJobSchema = z.object({
  companyId: z.uuidv4(),
  title: z.string().min(1).max(255),
  description: z.string().min(1),
  salaryMin: z.number().int().nonnegative().optional(),
  salaryMax: z.number().int().nonnegative().optional(),
  currency: z.enum(currencyValues).optional(),
  location: z.string().max(255).optional(),
  jobType: z.enum(jobTypeValues).optional(),
  contactWhatsapp: whatsappNumber.optional(),
  isRemote: z.boolean().optional(),
  status: z.enum(jobStatusValues).optional(),
  // Coerced to Date: the Drizzle `timestamp` column expects a Date, not the
  // ISO string the client sends over JSON.
  expiresAt: z.coerce.date().optional(),
});

export const updateJobSchema = createJobSchema
  .partial()
  .omit({ companyId: true });

export const jobIdParamSchema = z.object({
  id: z.uuidv4(),
});

export const jobSearchQuerySchema = z.object({
  q: z.string().optional(),
  isRemote: z
    .enum(["true", "false"])
    .optional()
    .transform((val) => (val === undefined ? undefined : val === "true")),
  location: z.string().optional(),
  companyId: z.uuidv4().optional(),
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

import { z } from "zod";
import { applicationStatusEnum } from "../../../db/schema/applications";

export const applyToJobSchema = z.object({
  jobId: z.uuidv4(),
  coverLetter: z.string().max(5000).optional(),
  // Optional override — if omitted, the applicant's profile cvUrl is used.
  resumeUrl: z.string().optional(),
});

export const updateApplicationStatusSchema = z.object({
  status: z.enum(applicationStatusEnum.enumValues),
});

export const updateApplicationNotesSchema = z.object({
  employerNotes: z.string().max(5000),
});

export const applicationIdParamSchema = z.object({
  id: z.uuidv4(),
});

// Reused for GET /jobs/:id/applications — :id there is a jobId
export const jobIdParamSchema = z.object({
  id: z.uuidv4(),
});

export type ApplyToJobInput = z.infer<typeof applyToJobSchema>;
export type UpdateApplicationStatusInput = z.infer<typeof updateApplicationStatusSchema>;
export type UpdateApplicationNotesInput = z.infer<typeof updateApplicationNotesSchema>;
import { z } from "zod";
import { reportReasonEnum, reportStatusEnum, reportTargetTypeEnum } from "../../../db";

export const createReportSchema = z.object({
  targetType: z.enum(reportTargetTypeEnum.enumValues),
  targetId: z.uuidv4(),
  reason: z.enum(reportReasonEnum.enumValues),
  note: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type CreateReportInput = z.input<typeof createReportSchema>;

export const listReportsQuerySchema = z.object({
  status: z.enum(reportStatusEnum.enumValues).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListReportsQuery = z.infer<typeof listReportsQuerySchema>;

export const reportIdParamSchema = z.object({ id: z.uuidv4() });

export const resolveReportSchema = z.object({
  status: z.enum(["dismissed", "actioned"]),
  /** Hide the reported item: closes a job, deletes a freelancer post. Companies are handled by hand. */
  takedown: z.boolean().default(false),
  note: z.string().trim().max(300).optional(),
});
export type ResolveReportInput = z.infer<typeof resolveReportSchema>;

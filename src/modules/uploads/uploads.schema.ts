import { z } from "zod";
export const companyLogoParamSchema = z.object({
  companyId: z.uuidv4(),
});

export const jobImageParamSchema = z.object({
  jobId: z.uuidv4(),
});

import { z } from "zod";
export const companyLogoParamSchema = z.object({
  companyId: z.uuidv4(),
});
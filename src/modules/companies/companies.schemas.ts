import { z } from "zod";

export const employeeCountValues = ["1-10", "11-50", "51-200", "200+"] as const;

export const createCompanySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  website: z.string().max(255).optional(),
  industry: z.string().max(100).optional(),
  employeeCount: z.enum(employeeCountValues).optional(),
  location: z.string().max(255).optional(),
});

export const updateCompanySchema = createCompanySchema.partial();

export const companyIdParamSchema = z.object({
  id: z.uuidv4(),
});

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

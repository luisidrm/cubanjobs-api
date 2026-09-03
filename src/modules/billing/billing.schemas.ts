import { z } from "zod";

export const paidPlanValues = ["basic", "pro"] as const;

// "web" vs "native" selects between two fixed, server-controlled return URLs
// (see billingReturnUrl in billing.queries.ts) — never a client-supplied URL,
// so this can't be abused as an open redirect.
export const platformValues = ["web", "native"] as const;

export const createCheckoutSessionSchema = z.object({
  companyId: z.uuidv4(),
  plan: z.enum(paidPlanValues),
  platform: z.enum(platformValues).optional(),
});

export const createPortalSessionSchema = z.object({
  companyId: z.uuidv4(),
  platform: z.enum(platformValues).optional(),
});

export type CreateCheckoutSessionInput = z.infer<typeof createCheckoutSessionSchema>;
export type CreatePortalSessionInput = z.infer<typeof createPortalSessionSchema>;

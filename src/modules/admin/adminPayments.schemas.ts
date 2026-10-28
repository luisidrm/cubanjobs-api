import { z } from "zod";
import { paymentStatusEnum } from "../../../db/schema/payments";
import { companyPlanEnum } from "../../../db/schema/companies";

export const idParamSchema = z.object({ id: z.uuidv4() });

export const listPaymentsQuerySchema = z.object({
  status: z.enum(paymentStatusEnum.enumValues).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
});

export const rejectPaymentSchema = z.object({
  reason: z.string().trim().min(3, "Tell the user why").max(300),
});

export const accountSearchQuerySchema = z.object({
  q: z.string().trim().min(2),
});

export const expiringQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(60).default(7),
});

// ISO date string or null (= no expiry). Past dates are refused so a typo
// can't silently downgrade someone at the next daily run.
const expiresAtSchema = z
  .union([z.iso.datetime(), z.null()])
  .transform((v) => (v === null ? null : new Date(v)))
  .refine((d) => d === null || d.getTime() > Date.now(), "The expiry date must be in the future");

export const setUserPlanSchema = z.object({
  plan: z.enum(["free", "paid"]),
  expiresAt: expiresAtSchema.default(null),
  note: z.string().trim().max(300).optional(),
});

export const setCompanyPlanSchema = z.object({
  plan: z.enum(companyPlanEnum.enumValues),
  expiresAt: expiresAtSchema.default(null),
  note: z.string().trim().max(300).optional(),
});

export const updatePlanSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    jobLimit: z.number().int().min(0).nullable(),
    candidateSearch: z.boolean(),
    isActive: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const planPriceParamSchema = z.object({
  id: z.uuidv4(),
  months: z.coerce.number().int().min(1).max(24),
});

export const upsertPriceSchema = z.object({
  priceCup: z.number().int().min(1).max(100_000_000),
  isActive: z.boolean().default(true),
});

/** Keys the admin may edit. Anything else is rejected, so this can't be used as a free-form store. */
export const SETTING_KEYS = [
  "destination_card",
  "destination_phone",
  "destination_holder",
  "instructions_es",
  "instructions_en",
  "reminder_days_before",
] as const;

export const updateSettingsSchema = z
  .record(z.string(), z.string().max(1000))
  .superRefine((value, ctx) => {
    for (const [key, v] of Object.entries(value)) {
      if (!(SETTING_KEYS as readonly string[]).includes(key)) {
        ctx.addIssue({ code: "custom", message: `Unknown setting: ${key}`, path: [key] });
      }
      if (key === "reminder_days_before") {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 30) {
          ctx.addIssue({ code: "custom", message: "reminder_days_before must be a whole number from 1 to 30", path: [key] });
        }
      }
    }
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: "custom", message: "Nothing to update" });
    }
  });

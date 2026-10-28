import { z } from "zod";

// Sent as multipart/form-data (the screenshot is optional), so every field
// arrives as a string and numbers are coerced.
export const submitPaymentSchema = z.object({
  planCode: z.string().min(1).max(50),
  months: z.coerce.number().int().min(1).max(24),
  companyId: z.uuidv4().optional(),
  transferNumber: z
    .string()
    .trim()
    .min(4, "The transfer number is required")
    .max(40)
    .regex(/^[A-Za-z0-9][A-Za-z0-9 \-_/]*$/, "The transfer number can only contain letters, numbers and dashes"),
});

export type SubmitPaymentInput = z.infer<typeof submitPaymentSchema>;

/** Uppercase, alphanumerics only: "tm-123 456" and "TM123456" are the same transfer. */
export function normalizeTransferNumber(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

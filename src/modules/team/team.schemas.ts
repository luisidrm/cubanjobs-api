import { z } from "zod";

export const teamParamSchema = z.object({
  id: z.uuidv4(),
});

export const teamMemberParamSchema = z.object({
  id: z.uuidv4(),
  userId: z.uuidv4(),
});

export const joinSchema = z.object({
  // Codes are shown uppercase but people type them any way they like.
  code: z
    .string()
    .trim()
    .min(4)
    .max(16)
    .transform((c) => c.toUpperCase().replace(/[\s-]/g, "")),
});

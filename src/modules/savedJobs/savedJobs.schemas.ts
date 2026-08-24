import { z } from "zod";

export const savedJobParamSchema = z.object({
  jobId: z.uuidv4(),
});

export type SavedJobParams = z.infer<typeof savedJobParamSchema>;

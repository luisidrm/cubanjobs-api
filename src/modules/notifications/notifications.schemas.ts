import { z } from "zod";

export const notificationIdParamSchema = z.object({
  id: z.uuidv4(),
});

export const listNotificationsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

export type NotificationIdParams = z.infer<typeof notificationIdParamSchema>;
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

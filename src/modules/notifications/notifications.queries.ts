import { and, desc, eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { notifications, type Notification, type NotificationType } from "../../../db";
import type { ListNotificationsQuery } from "./notifications.schemas";

export interface NewNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** Server-side only — not exposed via a route, called directly from the
 * module (e.g. applications) that produced the underlying event. */
export async function insertNotification(input: NewNotificationInput): Promise<void> {
  await db.insert(notifications).values(input);
}

export async function getNotificationsForUser(
  userId: string,
  { limit, offset }: ListNotificationsQuery
): Promise<Notification[]> {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit ?? 20)
    .offset(offset ?? 0);
}

export async function getUnreadCount(userId: string): Promise<number> {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
  return rows.length;
}

export async function markAsRead(userId: string, id: string): Promise<void> {
  await db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
}

export async function markAllAsRead(userId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
}

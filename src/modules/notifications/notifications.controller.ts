import type { Request, Response } from "express";
import {
  getNotificationsForUser,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
} from "./notifications.queries";
import { getValidatedParams, getValidatedQuery } from "../../middleware/validate";
import type { NotificationIdParams, ListNotificationsQuery } from "./notifications.schemas";

export async function list(req: Request, res: Response) {
  const query = getValidatedQuery<ListNotificationsQuery>(req);
  const data = await getNotificationsForUser(req.user!.id, query);
  res.status(200).json({ success: true, data });
}

export async function unreadCount(req: Request, res: Response) {
  const count = await getUnreadCount(req.user!.id);
  res.status(200).json({ success: true, data: { count } });
}

export async function markOneRead(req: Request, res: Response) {
  const { id } = getValidatedParams<NotificationIdParams>(req);
  await markAsRead(req.user!.id, id);
  res.status(204).send();
}

export async function markAllRead(req: Request, res: Response) {
  await markAllAsRead(req.user!.id);
  res.status(204).send();
}

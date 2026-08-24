import { Router } from "express";
import { list, unreadCount, markOneRead, markAllRead } from "./notifications.controller";
import { requireAuth } from "../../middleware/auth";
import { validateParams, validateQuery } from "../../middleware/validate";
import { notificationIdParamSchema, listNotificationsQuerySchema } from "./notifications.schemas";

const router = Router();

router.get("/", requireAuth, validateQuery(listNotificationsQuerySchema), list);
router.get("/unread-count", requireAuth, unreadCount);
router.patch("/read-all", requireAuth, markAllRead);
router.patch("/:id/read", requireAuth, validateParams(notificationIdParamSchema), markOneRead);

export default router;

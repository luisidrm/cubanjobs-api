import { pgTable, uuid, text, boolean, jsonb, index, pgEnum } from "drizzle-orm/pg-core";
import { users } from "./users";
import { timestamps } from "../helpers";

export const notificationTypeEnum = pgEnum("notification_type", [
  "application_status_changed",
  "plan_expiring",
  "plan_expired",
  "payment_approved",
  "payment_rejected",
  "team_member_joined",
  "report_resolved",
]);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),

    type: notificationTypeEnum("type").notNull(),

    title: text("title").notNull(),

    body: text("body").notNull(),

    data: jsonb("data"),

    read: boolean("read").default(false).notNull(),

    ...timestamps,
  },
  (table) => [
    index("notifications_user_id_idx").on(table.userId),
    index("notifications_user_id_read_idx").on(table.userId, table.read),
  ]
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type NotificationType = typeof notificationTypeEnum.enumValues[number];

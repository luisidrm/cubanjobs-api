import { pgTable, uuid, text, pgEnum, index, uniqueIndex, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";
import { timestamps } from "../helpers";

export const reportTargetTypeEnum = pgEnum("report_target_type", ["job", "freelancer_post", "company"]);

export const reportReasonEnum = pgEnum("report_reason", [
  "scam",
  "upfront_payment",
  "inappropriate",
  "spam",
  "fake",
  "other",
]);

export const reportStatusEnum = pgEnum("report_status", ["open", "dismissed", "actioned"]);

/**
 * A user's report of a job, freelancer post or company. The target is polymorphic
 * (type + id, no foreign key) so one table and one admin queue cover all of them.
 * One report per user per target; the admin resolves it and the reporter is notified.
 */
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    reporterId: uuid("reporter_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),

    targetType: reportTargetTypeEnum("target_type").notNull(),
    targetId: uuid("target_id").notNull(),

    reason: reportReasonEnum("reason").notNull(),
    note: text("note"),

    status: reportStatusEnum("status").notNull().default("open"),

    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at"),
    resolutionNote: text("resolution_note"),

    ...timestamps,
  },
  (table) => [
    uniqueIndex("reports_reporter_target_idx").on(table.reporterId, table.targetType, table.targetId),
    index("reports_status_created_idx").on(table.status, table.createdAt),
    index("reports_target_idx").on(table.targetType, table.targetId),
  ]
);

export type Report = typeof reports.$inferSelect;
export type ReportTargetType = (typeof reportTargetTypeEnum.enumValues)[number];
export type ReportReason = (typeof reportReasonEnum.enumValues)[number];
export type ReportStatus = (typeof reportStatusEnum.enumValues)[number];

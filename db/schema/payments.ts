import { pgTable, uuid, varchar, text, integer, timestamp, pgEnum, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { companies } from "./companies";
import { plans } from "./plans";
import { timestamps } from "../helpers";

export const paymentStatusEnum = pgEnum("payment_status", ["pending", "approved", "rejected"]);

/** Why an account's plan changed — written once per change. */
export const planEventReasonEnum = pgEnum("plan_event_reason", [
  "payment_approved",
  "manual",
  "expired",
  "stripe",
]);

/**
 * A Transfermóvil payment the user reports. The admin checks the transfer
 * and approves or rejects it; approval is what actually grants the plan.
 * Rows outlive their payer (set null) so the accounting history is kept.
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),

    /** Snapshot so the record stays readable if the user is deleted. */
    payerEmail: varchar("payer_email", { length: 255 }).notNull(),

    /** Set for employer plans: which company the plan is for. */
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),

    planId: uuid("plan_id")
      .references(() => plans.id, { onDelete: "restrict" })
      .notNull(),

    months: integer("months").notNull(),

    /** Price at the time of payment (prices can change later). */
    amountCup: integer("amount_cup").notNull(),

    /** The Transfermóvil confirmation number as the user typed it. */
    transferNumber: varchar("transfer_number", { length: 64 }).notNull(),

    /** Uppercased, alphanumerics only. Unique among non-rejected payments. */
    transferNumberNormalized: varchar("transfer_number_normalized", { length: 64 }).notNull(),

    /** Private-bucket object key of the optional screenshot. */
    screenshotKey: text("screenshot_key"),

    status: paymentStatusEnum("status").notNull().default("pending"),

    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),

    reviewedAt: timestamp("reviewed_at"),

    rejectReason: text("reject_reason"),

    ...timestamps,
  },
  (table) => [
    index("payments_status_idx").on(table.status),
    index("payments_user_id_idx").on(table.userId),
    // A rejected payment frees its transfer number so the user can resubmit
    // a corrected one; pending and approved numbers can never be reused.
    uniqueIndex("payments_transfer_active_unique")
      .on(table.transferNumberNormalized)
      .where(sql`${table.status} <> 'rejected'`),
  ]
);

/** Audit trail of every plan change. Exactly one of userId / companyId is set. */
export const planEvents = pgTable(
  "plan_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),

    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),

    fromPlan: varchar("from_plan", { length: 50 }).notNull(),

    toPlan: varchar("to_plan", { length: 50 }).notNull(),

    expiresAt: timestamp("expires_at"),

    reason: planEventReasonEnum("reason").notNull(),

    paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "set null" }),

    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),

    note: text("note"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("plan_events_user_id_idx").on(table.userId),
    index("plan_events_company_id_idx").on(table.companyId),
  ]
);

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
export type PaymentStatus = typeof paymentStatusEnum.enumValues[number];
export type PlanEvent = typeof planEvents.$inferSelect;

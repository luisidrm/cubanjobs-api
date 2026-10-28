import { pgTable, uuid, varchar, text, integer, boolean, pgEnum, unique } from "drizzle-orm/pg-core";
import { timestamps } from "../helpers";

export const planAudienceEnum = pgEnum("plan_audience", ["employee", "employer"]);

/**
 * Sellable plans. `code` matches the tier stored on the account:
 * "employee_paid" -> users.plan = "paid"; "basic" / "pro" -> companies.plan_tier.
 * Limits live here (not in code) so the admin can change them without a deploy.
 */
export const plans = pgTable("plans", {
  id: uuid("id").defaultRandom().primaryKey(),

  code: varchar("code", { length: 50 }).notNull().unique(),

  audience: planAudienceEnum("audience").notNull(),

  name: varchar("name", { length: 100 }).notNull(),

  /** Max active job posts for employer plans. null = unlimited (or not applicable). */
  jobLimit: integer("job_limit"),

  /** Employer plans only: max teammates in the company (owner included). null = unlimited. */
  seatLimit: integer("seat_limit"),

  /** Employer plans only: access to the paid candidate directory. */
  candidateSearch: boolean("candidate_search").notNull().default(false),

  sortOrder: integer("sort_order").notNull().default(0),

  isActive: boolean("is_active").notNull().default(true),

  ...timestamps,
});

/** One price per plan per duration (1, 3 or 6 months), in CUP. */
export const planPrices = pgTable(
  "plan_prices",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    planId: uuid("plan_id")
      .references(() => plans.id, { onDelete: "cascade" })
      .notNull(),

    months: integer("months").notNull(),

    priceCup: integer("price_cup").notNull(),

    isActive: boolean("is_active").notNull().default(true),

    ...timestamps,
  },
  (table) => [unique("plan_prices_plan_months_unique").on(table.planId, table.months)]
);

/**
 * Key/value settings the admin edits at runtime: the Transfermóvil
 * destination shown on the pay screen and the reminder lead time.
 */
export const paymentSettings = pgTable("payment_settings", {
  key: varchar("key", { length: 100 }).primaryKey(),

  value: text("value").notNull(),

  ...timestamps,
});

export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;
export type PlanPrice = typeof planPrices.$inferSelect;
export type PaymentSetting = typeof paymentSettings.$inferSelect;

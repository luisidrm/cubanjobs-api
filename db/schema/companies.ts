import { pgTable, uuid, varchar, text, boolean, index, pgEnum } from "drizzle-orm/pg-core";
import { users } from "./users";
import { timestamps } from "../helpers";

export const employeeCountEnum = pgEnum("employee_count", [
  "1-10",
  "11-50",
  "51-200",
  "200+",
]);

export const companyPlanEnum = pgEnum("company_plan", [
  "free",
  "basic",
  "pro",
]);

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    ownerId: uuid("owner_id").references(() => users.id, {
      onDelete: "set null",
    }),

    name: varchar("name", { length: 255 }).notNull(),

    description: text("description"),

    website: varchar("website", { length: 255 }),

    logoUrl: text("logo_url"),

    industry: varchar("industry", { length: 100 }),

    employeeCount: employeeCountEnum("employee_count"),

    location: varchar("location", { length: 255 }),

    isVerified: boolean("is_verified").notNull().default(false),

    planTier: companyPlanEnum("plan_tier").notNull().default("free"),

    ...timestamps,
  },
  (table) => [index("companies_owner_id_idx").on(table.ownerId)]
);

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type CompanyPlan = typeof companyPlanEnum.enumValues[number];

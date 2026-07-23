import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  index,
  pgEnum,
  timestamp,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { timestamps } from "../helpers";

export const jobTypeEnum = pgEnum("job_type", [
  "full_time",
  "part_time",
  "contract",
  "freelance",
  "internship",
]);

export const jobStatusEnum = pgEnum("job_status", [
  "draft",
  "active",
  "closed",
  "expired",
]);

export const currencyEnum = pgEnum("currency", ["CUP", "MLC", "USD"]);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),

    title: varchar("title", { length: 255 }).notNull(),

    description: text("description").notNull(),

    salaryMin: integer("salary_min"),

    salaryMax: integer("salary_max"),

    currency: currencyEnum("currency").default("CUP"),

    location: varchar("location", { length: 255 }),

    jobType: jobTypeEnum("job_type"),

    isRemote: boolean("is_remote").default(false).notNull(),

    status: jobStatusEnum("status").notNull().default("draft"),

    expiresAt: timestamp("expires_at"),

    viewCount: integer("view_count").notNull().default(0),

    ...timestamps,
  },
  (table) => [index("jobs_company_id_idx").on(table.companyId)]
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type JobStatus = typeof jobStatusEnum.enumValues[number];
export type Currency = typeof currencyEnum.enumValues[number];

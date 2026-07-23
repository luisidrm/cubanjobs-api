import {
  pgTable,
  uuid,
  text,
  index,
  unique,
  pgEnum,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { jobs } from "./jobs";
import { timestamps } from "../helpers";

export const applicationStatusEnum = pgEnum("application_status", [
  "pending",
  "reviewed",
  "rejected",
  "accepted",
]);

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),

    jobId: uuid("job_id")
      .references(() => jobs.id, { onDelete: "cascade" })
      .notNull(),

    status: applicationStatusEnum("status").default("pending").notNull(),

    coverLetter: text("cover_letter"),

    // Allows applicant to submit a CV different from their profile's default
    resumeUrl: text("resume_url"),

    // Private notes visible only to the employer
    employerNotes: text("employer_notes"),

    ...timestamps,
  },
  (table) => [
    unique("applications_user_job_unique").on(table.userId, table.jobId),
    index("applications_user_id_idx").on(table.userId),
    index("applications_job_id_idx").on(table.jobId),
  ]
);

export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;

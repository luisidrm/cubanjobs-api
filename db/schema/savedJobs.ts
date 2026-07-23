import { pgTable, uuid, primaryKey, index, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";
import { jobs } from "./jobs";

export const savedJobs = pgTable(
  "saved_jobs",
  {
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),

    jobId: uuid("job_id")
      .references(() => jobs.id, { onDelete: "cascade" })
      .notNull(),

    savedAt: timestamp("saved_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.jobId] }),
    index("saved_jobs_job_id_idx").on(table.jobId),
  ]
);
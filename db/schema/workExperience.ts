import { pgTable, uuid, varchar, text, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users";

export const workExperience = pgTable(
  "work_experience",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),

    title: varchar("title", { length: 150 }).notNull(),

    organization: varchar("organization", { length: 150 }),

    description: text("description"),

    // Owner-only — a past employer/reference's contact info. Never returned
    // from toPublicUser() or to other employers, see users.queries.ts.
    contact: varchar("contact", { length: 255 }),

    startDate: timestamp("start_date"),

    endDate: timestamp("end_date"), // null = current position
  },
  (table) => [index("work_experience_user_id_idx").on(table.userId)]
);

export type WorkExperience = typeof workExperience.$inferSelect;
export type NewWorkExperience = typeof workExperience.$inferInsert;

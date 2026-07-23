import { pgTable, uuid, varchar, primaryKey, index } from "drizzle-orm/pg-core";
import { users } from "./users";
import { jobs } from "./jobs";

export const tags = pgTable("tags", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
});

export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;

export const userTags = pgTable(
  "user_tags",
  {
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),

    tagId: uuid("tag_id")
      .references(() => tags.id, { onDelete: "cascade" })
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.tagId] }),
    // The composite PK already indexes (userId, tagId) leading with userId,
    // so a lookup "find all users with tag X" still needs its own index.
    index("user_tags_tag_id_idx").on(table.tagId),
  ]
);

export const jobTags = pgTable(
  "job_tags",
  {
    jobId: uuid("job_id")
      .references(() => jobs.id, { onDelete: "cascade" })
      .notNull(),

    tagId: uuid("tag_id")
      .references(() => tags.id, { onDelete: "cascade" })
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.tagId] }),
    index("job_tags_tag_id_idx").on(table.tagId),
  ]
);
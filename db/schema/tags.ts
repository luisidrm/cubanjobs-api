import { pgTable, uuid, varchar, primaryKey, index } from "drizzle-orm/pg-core";
import { jobs } from "./jobs";

export const tags = pgTable("tags", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
});

export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;

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
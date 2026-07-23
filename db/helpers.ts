import { timestamp } from "drizzle-orm/pg-core";

/**
 * Standard created_at / updated_at pair.
 * updated_at is auto-set by Drizzle on every `.update()` call via $onUpdate.
 * Note: $onUpdate only fires for updates issued through Drizzle's query
 * builder — raw SQL or other clients touching the table won't trigger it.
 */
export const timestamps = {
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
};
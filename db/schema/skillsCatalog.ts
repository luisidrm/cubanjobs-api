import { pgTable, uuid, varchar } from "drizzle-orm/pg-core";

export const skillsCatalog = pgTable("skills_catalog", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 150 }).notNull().unique(),
});

export type SkillCatalogEntry = typeof skillsCatalog.$inferSelect;
export type NewSkillCatalogEntry = typeof skillsCatalog.$inferInsert;

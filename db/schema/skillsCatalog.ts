import { pgTable, uuid, varchar } from "drizzle-orm/pg-core";

export const skillsCatalog = pgTable("skills_catalog", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** Canonical name (English). user_skills.skill stores this, so every spelling maps to one skill. */
  name: varchar("name", { length: 150 }).notNull().unique(),

  /** Spanish display name. null = no translation yet, clients fall back to `name`. */
  nameEs: varchar("name_es", { length: 150 }),
});

export type SkillCatalogEntry = typeof skillsCatalog.$inferSelect;
export type NewSkillCatalogEntry = typeof skillsCatalog.$inferInsert;

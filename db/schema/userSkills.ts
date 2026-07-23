import { pgTable, uuid, varchar, integer, index, unique } from "drizzle-orm/pg-core";
import { users } from "./users";

export const userSkills = pgTable(
  "user_skills",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),

    skill: varchar("skill", { length: 100 }).notNull(),

    yearsExperience: integer("years_experience"),
  },
  (table) => [
    index("user_skills_user_id_idx").on(table.userId),
    unique("user_skills_user_skill_unique").on(table.userId, table.skill),
  ]
);

export type UserSkill = typeof userSkills.$inferSelect;
export type NewUserSkill = typeof userSkills.$inferInsert;
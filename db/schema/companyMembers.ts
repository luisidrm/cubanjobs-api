import { pgTable, uuid, primaryKey, index, pgEnum } from "drizzle-orm/pg-core";
import { users } from "./users";
import { companies } from "./companies";
import { timestamps } from "../helpers";

export const companyMemberRoleEnum = pgEnum("company_member_role", ["owner", "admin"]);

export const companyMembers = pgTable(
  "company_members",
  {
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),

    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),

    role: companyMemberRoleEnum("role").notNull().default("admin"),

    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.companyId, table.userId] }),
    index("company_members_user_id_idx").on(table.userId),
  ]
);

export type CompanyMember = typeof companyMembers.$inferSelect;
export type NewCompanyMember = typeof companyMembers.$inferInsert;

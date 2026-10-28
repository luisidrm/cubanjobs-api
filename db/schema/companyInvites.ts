import { pgTable, uuid, varchar, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users";
import { companies } from "./companies";
import { timestamps } from "../helpers";

/**
 * Join codes owners share with teammates. At most one live (not revoked, not
 * expired) code per company: generating a new one revokes the previous.
 */
export const companyInvites = pgTable(
  "company_invites",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),

    code: varchar("code", { length: 16 }).notNull().unique(),

    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),

    expiresAt: timestamp("expires_at").notNull(),

    revokedAt: timestamp("revoked_at"),

    ...timestamps,
  },
  (table) => [index("company_invites_company_id_idx").on(table.companyId)]
);

export type CompanyInvite = typeof companyInvites.$inferSelect;

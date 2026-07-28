import { pgTable, uuid, varchar, text, boolean, pgEnum } from "drizzle-orm/pg-core";
import { timestamps } from "../helpers";

export const userRoleEnum = pgEnum("user_role", ["employer", "employee", "admin"]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),

  supertokensUserId: varchar("supertokens_user_id", { length: 255 }).notNull().unique(),

  email: varchar("email", { length: 255 }).notNull().unique(),

  role: userRoleEnum("role").notNull().default("employee"),

  isVerified: boolean("is_verified").notNull().default(false),

  firstName: varchar("first_name", { length: 100 }),

  lastName: varchar("last_name", { length: 100 }),

  phone: varchar("phone", { length: 30 }),

  bio: text("bio"),

  location: varchar("location", { length: 255 }),

  profilePictureUrl: text("profile_picture_url"),

  cvUrl: text("cv_url"),

  ...timestamps,
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserRole = typeof userRoleEnum.enumValues[number];

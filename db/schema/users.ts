import { pgTable, uuid, varchar, text, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { timestamps } from "../helpers";

export const userRoleEnum = pgEnum("user_role", ["employer", "employee", "admin"]);

/** Employee plan: free users browse and save; paid users can also apply. */
export const userPlanEnum = pgEnum("user_plan", ["free", "paid"]);

/** Where an account's paid plan came from — decides who may downgrade it. */
export const planSourceEnum = pgEnum("plan_source", ["none", "transfermovil", "stripe", "manual"]);

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

  linkedinUrl: text("linkedin_url"),

  expoPushToken: text("expo_push_token"),

  onboardingCompletedAt: timestamp("onboarding_completed_at"),

  plan: userPlanEnum("plan").notNull().default("free"),

  /** null on a paid plan = no expiry (set manually by an admin). */
  planExpiresAt: timestamp("plan_expires_at"),

  planSource: planSourceEnum("plan_source").notNull().default("none"),

  /** When the "expiring soon" reminder went out for the current period. */
  planReminderSentAt: timestamp("plan_reminder_sent_at"),

  /**
   * Last authenticated request seen from each client (x-platform header), kept
   * for the admin metrics. Throttled to one write per hour per platform; null =
   * never seen since tracking began.
   */
  webLastSeenAt: timestamp("web_last_seen_at"),

  appLastSeenAt: timestamp("app_last_seen_at"),

  ...timestamps,
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserRole = typeof userRoleEnum.enumValues[number];
export type UserPlan = typeof userPlanEnum.enumValues[number];
export type PlanSource = typeof planSourceEnum.enumValues[number];

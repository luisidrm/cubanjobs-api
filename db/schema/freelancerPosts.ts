import { pgTable, uuid, varchar, text, integer, index, primaryKey, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";
import { timestamps } from "../helpers";

/**
 * A paying employee's freelance offer. Visible to paid companies and other
 * paying employees; the only metric shown is the number of distinct viewers.
 */
export const freelancerPosts = pgTable(
  "freelancer_posts",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),

    title: varchar("title", { length: 120 }).notNull(),

    description: text("description").notNull(),

    /** Optional portfolio / social link. */
    linkUrl: text("link_url"),

    // Contact methods; the API requires at least one.
    contactPhone: varchar("contact_phone", { length: 32 }),
    contactWhatsapp: varchar("contact_whatsapp", { length: 32 }),
    contactEmail: varchar("contact_email", { length: 255 }),
    contactTelegram: varchar("contact_telegram", { length: 64 }),

    /** Public image URLs in display order (max 5, enforced by the API). */
    images: text("images").array().notNull().default([]),

    /** Distinct viewers other than the owner; kept in step with freelancer_post_views. */
    viewCount: integer("view_count").notNull().default(0),

    ...timestamps,
  },
  (table) => [index("freelancer_posts_user_id_idx").on(table.userId), index("freelancer_posts_created_at_idx").on(table.createdAt)]
);

/** One row per (post, viewer): lets the count be "distinct viewers" instead of raw hits. */
export const freelancerPostViews = pgTable(
  "freelancer_post_views",
  {
    postId: uuid("post_id")
      .references(() => freelancerPosts.id, { onDelete: "cascade" })
      .notNull(),

    viewerId: uuid("viewer_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),

    viewedAt: timestamp("viewed_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.postId, table.viewerId] })]
);

export type FreelancerPost = typeof freelancerPosts.$inferSelect;
export type NewFreelancerPost = typeof freelancerPosts.$inferInsert;

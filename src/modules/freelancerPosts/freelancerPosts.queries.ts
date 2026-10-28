import { and, count, desc, eq, gt, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "../../../db/client";
import { freelancerPostViews, freelancerPosts, users, type FreelancerPost } from "../../../db";
import { AppError } from "../../lib/AppError";
import type { RequestingUser } from "../companies/companies.queries";
import { MAX_IMAGES_PER_POST, MAX_POSTS_PER_USER, hasContact } from "./freelancerPosts.schemas";
import type { CreatePostInput, ListPostsQuery, UpdatePostInput } from "./freelancerPosts.schemas";

const authorColumns = {
  id: users.id,
  firstName: users.firstName,
  lastName: users.lastName,
  profilePictureUrl: users.profilePictureUrl,
  location: users.location,
};

type Author = { id: string; firstName: string | null; lastName: string | null; profilePictureUrl: string | null; location: string | null };

/** Only posts whose author still has an active paid plan are shown to others. */
const authorIsPaid = () => and(eq(users.plan, "paid"), or(isNull(users.planExpiresAt), gt(users.planExpiresAt, new Date())));

/** List cards: no contact details, those are for the detail screen. */
function toCard(p: FreelancerPost, author: Author) {
  return {
    id: p.id,
    title: p.title,
    description: p.description.length > 200 ? `${p.description.slice(0, 200)}...` : p.description,
    images: p.images,
    viewCount: p.viewCount,
    createdAt: p.createdAt,
    author,
  };
}

export async function listPosts(filters: ListPostsQuery) {
  const term = filters.q ? `%${filters.q.replace(/[\\%_]/g, "\\$&")}%` : null;
  const rows = await db
    .select({ post: freelancerPosts, author: authorColumns })
    .from(freelancerPosts)
    .innerJoin(users, eq(users.id, freelancerPosts.userId))
    .where(
      and(
        authorIsPaid(),
        term ? or(ilike(freelancerPosts.title, term), ilike(freelancerPosts.description, term)) : undefined
      )
    )
    .orderBy(desc(freelancerPosts.createdAt))
    .limit(filters.limit)
    .offset(filters.offset);
  return rows.map((r) => toCard(r.post, r.author));
}

export async function getMyPosts(userId: string) {
  return db.select().from(freelancerPosts).where(eq(freelancerPosts.userId, userId)).orderBy(desc(freelancerPosts.createdAt));
}

/** Throws 404 (not 403) for someone else's post so ids can't be probed. */
export async function getOwnedPost(user: RequestingUser, id: string): Promise<FreelancerPost> {
  const [post] = await db.select().from(freelancerPosts).where(eq(freelancerPosts.id, id));
  if (!post || (post.userId !== user.id && user.role !== "admin")) throw new AppError(404, "Post not found");
  return post;
}

/** Counts the viewer once per post. Returns true only the first time. */
async function recordView(postId: string, viewerId: string): Promise<boolean> {
  const inserted = await db
    .insert(freelancerPostViews)
    .values({ postId, viewerId })
    .onConflictDoNothing()
    .returning({ postId: freelancerPostViews.postId });
  if (inserted.length === 0) return false;
  await db
    .update(freelancerPosts)
    .set({ viewCount: sql`${freelancerPosts.viewCount} + 1` })
    .where(eq(freelancerPosts.id, postId));
  return true;
}

/** Full post with the author and contact details; counts the view for non-owners. */
export async function getPostDetail(user: RequestingUser, id: string) {
  const [row] = await db
    .select({ post: freelancerPosts, author: authorColumns, authorPaid: sql<boolean>`coalesce(${authorIsPaid()}, false)` })
    .from(freelancerPosts)
    .innerJoin(users, eq(users.id, freelancerPosts.userId))
    .where(eq(freelancerPosts.id, id));
  if (!row) throw new AppError(404, "Post not found");

  const isOwner = row.post.userId === user.id;
  const isAdmin = user.role === "admin";
  // A lapsed author's post is hidden from everyone but themselves (and admins).
  if (!isOwner && !isAdmin && !row.authorPaid) throw new AppError(404, "Post not found");

  let viewCount = row.post.viewCount;
  if (!isOwner && !isAdmin && (await recordView(id, user.id))) viewCount += 1;

  return { ...row.post, viewCount, author: row.author, isOwner };
}

export async function createPost(user: RequestingUser, input: CreatePostInput) {
  const [row] = await db.select({ n: count() }).from(freelancerPosts).where(eq(freelancerPosts.userId, user.id));
  if ((row?.n ?? 0) >= MAX_POSTS_PER_USER) {
    throw new AppError(409, `You can have up to ${MAX_POSTS_PER_USER} posts. Delete one to add another.`, {
      code: "POST_LIMIT_REACHED",
    });
  }
  const [post] = await db
    .insert(freelancerPosts)
    .values({ ...input, userId: user.id })
    .returning();
  return post!;
}

export async function updatePost(user: RequestingUser, id: string, input: UpdatePostInput) {
  const existing = await getOwnedPost(user, id);
  if (!hasContact({ ...existing, ...input })) throw new AppError(400, "Keep at least one way to contact you");
  const [post] = await db.update(freelancerPosts).set(input).where(eq(freelancerPosts.id, id)).returning();
  return post!;
}

/** Returns the deleted post so the caller can clean up its images. */
export async function deletePost(user: RequestingUser, id: string): Promise<FreelancerPost> {
  const existing = await getOwnedPost(user, id);
  await db.delete(freelancerPosts).where(eq(freelancerPosts.id, id));
  return existing;
}

/** Appends an image URL, enforcing the cap in the UPDATE so concurrent uploads can't exceed it. */
export async function addImage(postId: string, url: string): Promise<FreelancerPost | null> {
  const [post] = await db
    .update(freelancerPosts)
    .set({ images: sql`array_append(${freelancerPosts.images}, ${url})` })
    .where(
      and(eq(freelancerPosts.id, postId), sql`coalesce(cardinality(${freelancerPosts.images}), 0) < ${MAX_IMAGES_PER_POST}`)
    )
    .returning();
  return post ?? null;
}

export async function removeImage(postId: string, url: string): Promise<FreelancerPost> {
  const [post] = await db
    .update(freelancerPosts)
    .set({ images: sql`array_remove(${freelancerPosts.images}, ${url})` })
    .where(eq(freelancerPosts.id, postId))
    .returning();
  return post!;
}

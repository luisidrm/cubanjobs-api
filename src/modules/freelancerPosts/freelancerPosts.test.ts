import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../../db/client";
import { companies, companyMembers, freelancerPosts, users } from "../../../db";
import { AppError } from "../../lib/AppError";
import { requireFreelancerAccess } from "../../middleware/plan";
import type { RequestingUser } from "../companies/companies.queries";
import {
  addImage,
  createPost,
  deletePost,
  getPostDetail,
  listPosts,
  removeImage,
  updatePost,
} from "./freelancerPosts.queries";
import { MAX_IMAGES_PER_POST, MAX_POSTS_PER_USER, createPostSchema, updatePostSchema } from "./freelancerPosts.schemas";

const suffix = randomUUID().slice(0, 8);
const future = new Date(Date.now() + 30 * 24 * 3600 * 1000);
const past = new Date(Date.now() - 24 * 3600 * 1000);

const userIds: string[] = [];
const companyIds: string[] = [];

async function makeUser(label: string, values: Partial<typeof users.$inferInsert> = {}) {
  const [u] = await db
    .insert(users)
    .values({
      supertokensUserId: `st-${suffix}-${label}`,
      email: `${label}-${suffix}@example.com`,
      role: "employee",
      firstName: label,
      ...values,
    })
    .returning();
  userIds.push(u!.id);
  return u!;
}

const asUser = (u: { id: string; role: "employee" | "employer" | "admin" }): RequestingUser => ({ id: u.id, role: u.role });
const validInput = (over: Record<string, unknown> = {}) =>
  createPostSchema.parse({ title: "Logo design", description: "I design logos and brand kits.", contactWhatsapp: "+5355555555", ...over });

/** Runs the access middleware and reports the error it forwarded (undefined = allowed). */
async function accessResult(user: RequestingUser): Promise<unknown> {
  let forwarded: unknown;
  await requireFreelancerAccess({ user } as never, {} as never, ((e?: unknown) => {
    forwarded = e;
  }) as never);
  return forwarded;
}

let owner: typeof users.$inferSelect;
let paidViewer: typeof users.$inferSelect;
let paidViewer2: typeof users.$inferSelect;
let freeViewer: typeof users.$inferSelect;
let lapsedAuthor: typeof users.$inferSelect;

beforeAll(async () => {
  paidViewer = await makeUser("viewer1", { plan: "paid", planExpiresAt: null });
  paidViewer2 = await makeUser("viewer2", { plan: "paid", planExpiresAt: future });
  freeViewer = await makeUser("free");
  lapsedAuthor = await makeUser("lapsed", { plan: "paid", planExpiresAt: past });
});

// A fresh owner per test: each user is capped at MAX_POSTS_PER_USER posts.
let ownerSeq = 0;
beforeEach(async () => {
  owner = await makeUser(`owner${ownerSeq++}`, { plan: "paid", planExpiresAt: future });
});

afterAll(async () => {
  // Posts and views cascade from the users; companies cascade their members.
  if (companyIds.length) await db.delete(companies).where(inArray(companies.id, companyIds));
  if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
});

describe("input validation", () => {
  it("requires at least one contact method", () => {
    const r = createPostSchema.safeParse({ title: "Logo design", description: "I design logos and brand kits." });
    expect(r.success).toBe(false);
  });

  it("treats blank contact fields as missing", () => {
    const r = createPostSchema.safeParse({
      title: "Logo design",
      description: "I design logos and brand kits.",
      contactPhone: "  ",
      contactEmail: "",
    });
    expect(r.success).toBe(false);
  });

  it("rejects links that are not http(s)", () => {
    expect(createPostSchema.safeParse({ ...validInput(), linkUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(createPostSchema.safeParse({ ...validInput(), linkUrl: "https://example.com/me" }).success).toBe(true);
  });

  it("rejects a malformed contact email", () => {
    expect(createPostSchema.safeParse({ ...validInput(), contactEmail: "not-an-email" }).success).toBe(false);
  });

  it("allows partial updates", () => {
    expect(updatePostSchema.safeParse({ title: "New title" }).success).toBe(true);
  });
});

describe("posting", () => {
  it("caps each user at the post limit", async () => {
    const poster = await makeUser("poster", { plan: "paid", planExpiresAt: future });
    for (let i = 0; i < MAX_POSTS_PER_USER; i++) await createPost(asUser(poster), validInput({ title: `Post ${i}` }));
    await expect(createPost(asUser(poster), validInput())).rejects.toMatchObject({
      statusCode: 409,
      details: { code: "POST_LIMIT_REACHED" },
    });
  });

  it("will not let an update remove the last contact method", async () => {
    const post = await createPost(asUser(owner), validInput());
    await expect(updatePost(asUser(owner), post.id, { contactWhatsapp: null })).rejects.toMatchObject({ statusCode: 400 });
    await deletePost(asUser(owner), post.id);
  });

  it("hides other users' posts behind a 404 for edit and delete", async () => {
    const post = await createPost(asUser(owner), validInput());
    await expect(updatePost(asUser(paidViewer), post.id, { title: "Hijacked" })).rejects.toMatchObject({ statusCode: 404 });
    await expect(deletePost(asUser(paidViewer), post.id)).rejects.toMatchObject({ statusCode: 404 });
    // An admin may moderate.
    await deletePost({ id: randomUUID(), role: "admin" }, post.id);
  });
});

describe("viewing and the viewer count", () => {
  it("counts each viewer once and never the owner", async () => {
    const post = await createPost(asUser(owner), validInput());

    expect((await getPostDetail(asUser(owner), post.id)).viewCount).toBe(0);
    expect((await getPostDetail(asUser(paidViewer), post.id)).viewCount).toBe(1);
    expect((await getPostDetail(asUser(paidViewer), post.id)).viewCount).toBe(1);
    expect((await getPostDetail(asUser(paidViewer2), post.id)).viewCount).toBe(2);

    const [row] = await db.select().from(freelancerPosts).where(eq(freelancerPosts.id, post.id));
    expect(row!.viewCount).toBe(2);
  });

  it("counts concurrent first views from one viewer only once", async () => {
    const post = await createPost(asUser(owner), validInput());
    await Promise.all(Array.from({ length: 5 }, () => getPostDetail(asUser(paidViewer), post.id)));
    const [row] = await db.select().from(freelancerPosts).where(eq(freelancerPosts.id, post.id));
    expect(row!.viewCount).toBe(1);
  });

  it("includes contact details and the author on the detail view", async () => {
    const post = await createPost(asUser(owner), validInput({ contactEmail: "me@example.com" }));
    const detail = await getPostDetail(asUser(paidViewer), post.id);
    expect(detail.contactEmail).toBe("me@example.com");
    expect(detail.author.id).toBe(owner.id);
    expect(detail.isOwner).toBe(false);
  });

  it("hides a lapsed author's post from others but not from the author", async () => {
    // Rows written directly: a lapsed user could not create one through the API.
    const [post] = await db
      .insert(freelancerPosts)
      .values({ userId: lapsedAuthor.id, title: "Old offer", description: "Posted before the plan lapsed.", contactPhone: "555" })
      .returning();
    await expect(getPostDetail(asUser(paidViewer), post!.id)).rejects.toMatchObject({ statusCode: 404 });
    expect((await getPostDetail(asUser(lapsedAuthor), post!.id)).isOwner).toBe(true);
  });
});

describe("listing", () => {
  it("omits contact details and lapsed authors, and filters by text", async () => {
    const unique = `zebra${suffix}`;
    await createPost(asUser(owner), validInput({ title: `${unique} photography` }));
    await db
      .insert(freelancerPosts)
      .values({ userId: lapsedAuthor.id, title: `${unique} expired`, description: "Should not be listed.", contactPhone: "1" });

    const found = await listPosts({ q: unique, limit: 20, offset: 0 });
    expect(found).toHaveLength(1);
    expect(found[0]!.title).toBe(`${unique} photography`);
    expect(found[0]).not.toHaveProperty("contactWhatsapp");
    expect(found[0]).not.toHaveProperty("contactEmail");
  });

  it("treats % and _ in the search as plain text", async () => {
    const found = await listPosts({ q: "%", limit: 20, offset: 0 });
    expect(found.every((p) => p.title.includes("%") || p.description.includes("%"))).toBe(true);
  });
});

describe("images", () => {
  it("stops at the image limit even under concurrent uploads", async () => {
    const post = await createPost(asUser(owner), validInput());
    const results = await Promise.all(
      Array.from({ length: MAX_IMAGES_PER_POST + 3 }, (_, i) => addImage(post.id, `http://x/${suffix}/${i}.jpg`))
    );
    expect(results.filter(Boolean)).toHaveLength(MAX_IMAGES_PER_POST);
    const [row] = await db.select().from(freelancerPosts).where(eq(freelancerPosts.id, post.id));
    expect(row!.images).toHaveLength(MAX_IMAGES_PER_POST);
  });

  it("removes a single image", async () => {
    const post = await createPost(asUser(owner), validInput());
    await addImage(post.id, "http://x/a.jpg");
    await addImage(post.id, "http://x/b.jpg");
    const updated = await removeImage(post.id, "http://x/a.jpg");
    expect(updated.images).toEqual(["http://x/b.jpg"]);
  });
});

describe("browse access", () => {
  it("allows paying employees and admins", async () => {
    expect(await accessResult(asUser(paidViewer))).toBeUndefined();
    expect(await accessResult({ id: randomUUID(), role: "admin" })).toBeUndefined();
  });

  it("answers 402 PLAN_REQUIRED to free and lapsed employees", async () => {
    for (const u of [freeViewer, lapsedAuthor]) {
      const err = await accessResult(asUser(u));
      expect(err).toBeInstanceOf(AppError);
      expect(err).toMatchObject({ statusCode: 402, details: { code: "PLAN_REQUIRED" } });
    }
  });

  it("allows employers on a paid company plan and refuses the free tier", async () => {
    const paidEmployer = await makeUser("emp-paid", { role: "employer" });
    const freeEmployer = await makeUser("emp-free", { role: "employer" });

    const [paidCo] = await db.insert(companies).values({ name: `Paid Co ${suffix}`, planTier: "basic" }).returning();
    const [freeCo] = await db.insert(companies).values({ name: `Free Co ${suffix}`, planTier: "free" }).returning();
    companyIds.push(paidCo!.id, freeCo!.id);
    await db.insert(companyMembers).values([
      { companyId: paidCo!.id, userId: paidEmployer.id, role: "owner" },
      { companyId: freeCo!.id, userId: freeEmployer.id, role: "owner" },
    ]);

    expect(await accessResult(asUser(paidEmployer))).toBeUndefined();
    expect(await accessResult(asUser(freeEmployer))).toMatchObject({ statusCode: 402 });
  });
});

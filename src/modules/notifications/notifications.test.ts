import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../../db/client";
import { users } from "../../../db";
import {
  getNotificationsForUser,
  getUnreadCount,
  insertNotification,
  markAllAsRead,
  markAsRead,
} from "./notifications.queries";

const suffix = randomUUID().slice(0, 8);
const userIds: string[] = [];

async function makeUser(label: string) {
  const [u] = await db
    .insert(users)
    .values({ supertokensUserId: `st-${suffix}-${label}`, email: `${label}-${suffix}@example.com`, role: "employee" })
    .returning();
  userIds.push(u!.id);
  return u!;
}

const note = (userId: string, title: string) =>
  insertNotification({ userId, type: "payment_approved", title, body: "body" });

afterAll(async () => {
  await db.delete(users).where(inArray(users.id, userIds));
});

describe("notifications", () => {
  it("lists newest first and pages", async () => {
    const user = await makeUser("a");
    for (const t of ["one", "two", "three"]) await note(user.id, t);

    const all = await getNotificationsForUser(user.id, { limit: 20, offset: 0 });
    expect(all.map((n) => n.title)).toEqual(["three", "two", "one"]);

    const second = await getNotificationsForUser(user.id, { limit: 2, offset: 2 });
    expect(second.map((n) => n.title)).toEqual(["one"]);
  });

  it("counts only unread ones", async () => {
    const user = await makeUser("b");
    await note(user.id, "x");
    await note(user.id, "y");
    expect(await getUnreadCount(user.id)).toBe(2);

    const [first] = await getNotificationsForUser(user.id, { limit: 1, offset: 0 });
    await markAsRead(user.id, first!.id);

    expect(await getUnreadCount(user.id)).toBe(1);
  });

  it("never lets one user mark another's notification as read", async () => {
    const owner = await makeUser("c");
    const intruder = await makeUser("d");
    await note(owner.id, "private");
    const [n] = await getNotificationsForUser(owner.id, { limit: 1, offset: 0 });

    await markAsRead(intruder.id, n!.id);

    expect(await getUnreadCount(owner.id)).toBe(1);
  });

  it("marks everything read for one user only", async () => {
    const a = await makeUser("e");
    const b = await makeUser("f");
    await note(a.id, "1");
    await note(a.id, "2");
    await note(b.id, "3");

    await markAllAsRead(a.id);

    expect(await getUnreadCount(a.id)).toBe(0);
    expect(await getUnreadCount(b.id)).toBe(1);
  });
});

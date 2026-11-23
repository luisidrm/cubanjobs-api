import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../../db/client";
import { users, workExperience } from "../../../db";
import { AppError } from "../../lib/AppError";
import { addExperience, deleteExperience, updateExperience } from "./workExperience.queries";

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

async function status(p: Promise<unknown>) {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return (err as AppError).statusCode;
}

afterAll(async () => {
  await db.delete(users).where(inArray(users.id, userIds));
});

describe("work experience", () => {
  it("adds and updates an entry", async () => {
    const user = await makeUser("a");
    const entry = await addExperience(user.id, { title: "Cashier", organization: "Shop" });
    expect(entry).toMatchObject({ userId: user.id, title: "Cashier" });

    const updated = await updateExperience(entry.id, user.id, { title: "Head cashier" });
    expect(updated).toMatchObject({ title: "Head cashier", organization: "Shop" });
  });

  it("treats someone else's entry as missing, for update and delete", async () => {
    const owner = await makeUser("b");
    const other = await makeUser("c");
    const entry = await addExperience(owner.id, { title: "Mine" });

    expect(await status(updateExperience(entry.id, other.id, { title: "Hijacked" }))).toBe(404);
    expect(await status(deleteExperience(entry.id, other.id))).toBe(404);

    const [still] = await db.select().from(workExperience).where(inArray(workExperience.id, [entry.id]));
    expect(still?.title).toBe("Mine");
  });

  it("deletes an entry", async () => {
    const user = await makeUser("d");
    const entry = await addExperience(user.id, { title: "Temp" });

    await deleteExperience(entry.id, user.id);

    expect(await status(deleteExperience(entry.id, user.id))).toBe(404);
  });
});

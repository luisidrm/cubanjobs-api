import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../../db/client";
import { userSkills, users } from "../../../db";
import { addSkill, removeSkill } from "./users.queries";

const suffix = randomUUID().slice(0, 8);
let userId: string;

beforeAll(async () => {
  const [u] = await db
    .insert(users)
    .values({ supertokensUserId: `st-${suffix}-skills`, email: `skills-${suffix}@example.com`, role: "employee" })
    .returning();
  userId = u!.id;
});

afterAll(async () => {
  await db.delete(users).where(eq(users.id, userId));
});

describe("addSkill", () => {
  it("adds a skill without years of experience (what the profile screen sends)", async () => {
    const row = await addSkill(userId, { skill: "Node.js" });
    expect(row.skill).toBe("Node.js");
    expect(row.yearsExperience).toBeNull();
  });

  it("adds a skill with years of experience", async () => {
    const row = await addSkill(userId, { skill: "TypeScript", yearsExperience: 3 });
    expect(row.yearsExperience).toBe(3);
  });

  it("re-adding a skill without years keeps the years it already had", async () => {
    const again = await addSkill(userId, { skill: "TypeScript" });
    expect(again.yearsExperience).toBe(3);
  });

  it("re-adding a skill with new years updates them and never duplicates the skill", async () => {
    const updated = await addSkill(userId, { skill: "TypeScript", yearsExperience: 5 });
    expect(updated.yearsExperience).toBe(5);
    const rows = await db.select().from(userSkills).where(eq(userSkills.userId, userId));
    expect(rows.filter((r) => r.skill === "TypeScript")).toHaveLength(1);
  });

  it("removes only the caller's own skill", async () => {
    const row = await addSkill(userId, { skill: "Docker" });
    await removeSkill(randomUUID(), row.id);
    expect(await db.select().from(userSkills).where(eq(userSkills.id, row.id))).toHaveLength(1);
    await removeSkill(userId, row.id);
    expect(await db.select().from(userSkills).where(eq(userSkills.id, row.id))).toHaveLength(0);
  });
});

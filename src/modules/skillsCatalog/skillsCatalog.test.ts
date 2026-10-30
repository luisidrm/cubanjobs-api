import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SKILLS_CATALOG } from "../../../scripts/seedData/skillsCatalog";
import { SKILLS_CATALOG_ES } from "../../../scripts/seedData/skillsCatalogEs";
import { db } from "../../../db/client";
import { skillsCatalog, userSkills, users } from "../../../db";
import { addSkill, canonicalSkillName, searchWorkers } from "../users/users.queries";

describe("catalog translations", () => {
  it("has a Spanish name for every catalog entry and none for unknown ones", () => {
    expect(SKILLS_CATALOG.filter((n) => !SKILLS_CATALOG_ES[n]?.trim())).toEqual([]);
    expect(Object.keys(SKILLS_CATALOG_ES).filter((n) => !SKILLS_CATALOG.includes(n))).toEqual([]);
  });

  it("never gives two entries the same Spanish name (the picker would show duplicates)", () => {
    const spanish = SKILLS_CATALOG.map((n) => SKILLS_CATALOG_ES[n]!.toLowerCase());
    const dupes = spanish.filter((s, i) => spanish.indexOf(s) !== i);
    expect(dupes).toEqual([]);
  });
});

describe("skills in either language", () => {
  const suffix = randomUUID().slice(0, 8);
  const english = `Plumber ${suffix}`;
  const spanish = `Plomero ${suffix}`;
  let catalogId: string;
  let userId: string;

  beforeAll(async () => {
    const [c] = await db.insert(skillsCatalog).values({ name: english, nameEs: spanish }).returning();
    catalogId = c!.id;
    const [u] = await db
      .insert(users)
      .values({ supertokensUserId: `st-${suffix}`, email: `skills-${suffix}@example.com`, role: "employee", firstName: `Ana${suffix}` })
      .returning();
    userId = u!.id;
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(skillsCatalog).where(inArray(skillsCatalog.id, [catalogId]));
  });

  it("maps either language, in any case, to the canonical English name", async () => {
    expect(await canonicalSkillName(english)).toBe(english);
    expect(await canonicalSkillName(spanish)).toBe(english);
    expect(await canonicalSkillName(spanish.toUpperCase())).toBe(english);
    expect(await canonicalSkillName(`  ${spanish.toLowerCase()}  `)).toBe(english);
  });

  it("keeps a skill that is not in the catalog exactly as typed", async () => {
    expect(await canonicalSkillName("  Soldadura TIG  ")).toBe("Soldadura TIG");
  });

  it("stores one skill when the same one is added in both languages", async () => {
    const first = await addSkill(userId, { skill: spanish });
    const second = await addSkill(userId, { skill: english });
    expect(first.skill).toBe(english);
    expect(second.id).toBe(first.id);
    const rows = await db.select().from(userSkills).where(eq(userSkills.userId, userId));
    expect(rows).toHaveLength(1);
  });

  it("finds a worker by the Spanish name of their skill", async () => {
    const found = await searchWorkers({ q: `Plomero ${suffix}`, skills: undefined, limit: 20, offset: 0 });
    expect(found.map((w) => w.id)).toContain(userId);
    const byEnglish = await searchWorkers({ q: `Plumber ${suffix}`, skills: undefined, limit: 20, offset: 0 });
    expect(byEnglish.map((w) => w.id)).toContain(userId);
  });
});

import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../../db/client";
import { users } from "../../../db";
import { searchWorkers } from "./users.queries";

const suffix = randomUUID().slice(0, 8);
const ids: string[] = [];

async function make(label: string, values: Partial<typeof users.$inferInsert>) {
  const [u] = await db
    .insert(users)
    .values({ supertokensUserId: `st-${suffix}-${label}`, email: `${label}-${suffix}@example.com`, role: "employee", ...values })
    .returning();
  ids.push(u!.id);
  return u!;
}

let named: Awaited<ReturnType<typeof make>>;
let nameless: Awaited<ReturnType<typeof make>>;
let blank: Awaited<ReturnType<typeof make>>;
let employer: Awaited<ReturnType<typeof make>>;

beforeAll(async () => {
  named = await make("named", { firstName: `Zed${suffix}`, bio: "Backend developer" });
  nameless = await make("nameless", { bio: `Zed${suffix} but no first name` });
  blank = await make("blank", { firstName: "   ", bio: `Zed${suffix} whitespace name` });
  employer = await make("employer", { role: "employer", firstName: `Zed${suffix}` });
});

afterAll(async () => {
  await db.delete(users).where(inArray(users.id, ids));
});

describe("searchWorkers", () => {
  it("lists employees with a name and skips empty profiles and non-employees", async () => {
    const found = await searchWorkers({ q: `Zed${suffix}`, skills: undefined, limit: 50, offset: 0 });
    const got = found.map((w) => w.id);
    expect(got).toContain(named.id);
    expect(got).not.toContain(nameless.id);
    expect(got).not.toContain(blank.id);
    expect(got).not.toContain(employer.id);
  });

  it("never returns a profile with no name at all", async () => {
    const found = await searchWorkers({ skills: undefined, limit: 200, offset: 0 });
    expect(found.every((w) => (w.firstName ?? "").trim() !== "")).toBe(true);
  });

  it("pages without repeating anyone", async () => {
    const all = await searchWorkers({ skills: undefined, limit: 200, offset: 0 });
    const firstPage = await searchWorkers({ skills: undefined, limit: 2, offset: 0 });
    const secondPage = await searchWorkers({ skills: undefined, limit: 2, offset: 2 });
    const ids2 = [...firstPage, ...secondPage].map((w) => w.id);
    expect(new Set(ids2).size).toBe(ids2.length);
    expect(ids2).toEqual(all.slice(0, ids2.length).map((w) => w.id));
  });
});

import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../../db/client";
import { companies, companyInvites, companyMembers, notifications, users } from "../../../db";
import { AppError } from "../../lib/AppError";
import { assertCompanyOwner, getCompanyById, getMyCompaniesWithRole, toPublicCompany } from "../companies/companies.queries";
import { createInvite, getTeam, joinByCode, removeMember, revokeInvite } from "./team.queries";

const suffix = randomUUID().slice(0, 8);
const userIds: string[] = [];
const companyIds: string[] = [];

async function makeUser(label: string, role: "employer" | "employee" | "admin" = "employer") {
  const [u] = await db
    .insert(users)
    .values({ supertokensUserId: `st-${suffix}-${label}`, email: `${label}-${suffix}@example.com`, role })
    .returning();
  userIds.push(u!.id);
  return u!;
}

async function makeCompany(ownerId: string, planTier: "free" | "basic" | "pro") {
  const [c] = await db
    .insert(companies)
    .values({ name: `Team Co ${randomUUID().slice(0, 6)}`, ownerId, planTier })
    .returning();
  companyIds.push(c!.id);
  await db.insert(companyMembers).values({ companyId: c!.id, userId: ownerId, role: "owner" });
  return c!;
}

async function rejects(p: Promise<unknown>, status: number) {
  const err = await p.then(
    () => null,
    (e) => e
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).statusCode).toBe(status);
  return err as AppError;
}

afterAll(async () => {
  await db.delete(notifications).where(inArray(notifications.userId, userIds));
  await db.delete(companies).where(inArray(companies.id, companyIds));
  await db.delete(users).where(inArray(users.id, userIds));
});

describe("company teams", () => {
  it("only the owner can create a code; members and outsiders cannot", async () => {
    const owner = await makeUser("owner1");
    const member = await makeUser("member1");
    const outsider = await makeUser("outsider1");
    const co = await makeCompany(owner.id, "pro");

    const { code } = await createInvite(owner, co.id);
    await joinByCode(member, code);

    await rejects(createInvite(member, co.id), 403);
    await rejects(createInvite(outsider, co.id), 403);
    await rejects(revokeInvite(member, co.id), 403);
  });

  it("joining gives access to the company and tells the owner", async () => {
    const owner = await makeUser("owner2");
    const member = await makeUser("member2");
    const co = await makeCompany(owner.id, "basic");

    const { code } = await createInvite(owner, co.id);
    await joinByCode(member, code);

    // member can manage the company's jobs/applicants...
    await expect(getTeam(member, co.id)).resolves.toMatchObject({ seatsUsed: 2, canManage: false, invite: null });
    // ...but not billing or deletion
    await rejects(assertCompanyOwner(await getCompanyById(co.id), member), 403);

    const [note] = await db.select().from(notifications).where(eq(notifications.userId, owner.id));
    expect(note?.type).toBe("team_member_joined");

    const mine = await getMyCompaniesWithRole(member);
    expect(mine[0]).toMatchObject({ memberRole: "member", planExpiresAt: null, stripeCustomerId: null });
  });

  it("codes are case-insensitive input but unknown, revoked and replaced codes are rejected", async () => {
    const owner = await makeUser("owner3");
    const a = await makeUser("joiner3a");
    const b = await makeUser("joiner3b");
    const co = await makeCompany(owner.id, "pro");

    const first = await createInvite(owner, co.id);
    const second = await createInvite(owner, co.id); // replaces the first
    expect(second.code).not.toBe(first.code);
    await rejects(joinByCode(a, first.code), 404);
    await rejects(joinByCode(a, "ZZZZZZZZ"), 404);

    await revokeInvite(owner, co.id);
    await rejects(joinByCode(a, second.code), 404);
    expect((await getTeam(owner, co.id)).invite).toBeNull();

    const third = await createInvite(owner, co.id);
    await joinByCode(b, third.code);
  });

  it("expired codes are rejected", async () => {
    const owner = await makeUser("owner4");
    const joiner = await makeUser("joiner4");
    const co = await makeCompany(owner.id, "pro");
    const { code } = await createInvite(owner, co.id);
    await db.update(companyInvites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(companyInvites.code, code));
    await rejects(joinByCode(joiner, code), 404);
  });

  it("enforces seat limits: free 1, basic 3, pro unlimited", async () => {
    // free: the owner already fills the single seat
    const freeOwner = await makeUser("owner5f");
    const freeCo = await makeCompany(freeOwner.id, "free");
    const freeInvite = await createInvite(freeOwner, freeCo.id);
    const err = await rejects(joinByCode(await makeUser("j5f"), freeInvite.code), 403);
    expect(err.details).toMatchObject({ code: "SEAT_LIMIT_REACHED", limit: 1 });

    // basic: owner + 2 fit, the 4th person is refused
    const bOwner = await makeUser("owner5b");
    const bCo = await makeCompany(bOwner.id, "basic");
    const { code } = await createInvite(bOwner, bCo.id);
    await joinByCode(await makeUser("j5b1"), code);
    await joinByCode(await makeUser("j5b2"), code);
    await rejects(joinByCode(await makeUser("j5b3"), code), 403);
    expect((await getTeam(bOwner, bCo.id)).seatLimit).toBe(3);

    // pro: no cap
    const pOwner = await makeUser("owner5p");
    const pCo = await makeCompany(pOwner.id, "pro");
    const pInvite = await createInvite(pOwner, pCo.id);
    for (let i = 0; i < 5; i++) await joinByCode(await makeUser(`j5p${i}`), pInvite.code);
    const team = await getTeam(pOwner, pCo.id);
    expect(team.seatLimit).toBeNull();
    expect(team.seatsUsed).toBe(6);
  });

  it("two people racing for the last seat can't both get in", async () => {
    const owner = await makeUser("owner6");
    const co = await makeCompany(owner.id, "basic");
    const { code } = await createInvite(owner, co.id);
    await joinByCode(await makeUser("j6a"), code); // 2 of 3
    const results = await Promise.allSettled([joinByCode(await makeUser("j6b"), code), joinByCode(await makeUser("j6c"), code)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await getTeam(owner, co.id)).seatsUsed).toBe(3);
  });

  it("joining twice is a conflict", async () => {
    const owner = await makeUser("owner7");
    const joiner = await makeUser("joiner7");
    const co = await makeCompany(owner.id, "pro");
    const { code } = await createInvite(owner, co.id);
    await joinByCode(joiner, code);
    await rejects(joinByCode(joiner, code), 409);
  });

  it("owner removes members, members can leave, the owner can't be removed", async () => {
    const owner = await makeUser("owner8");
    const m1 = await makeUser("m8a");
    const m2 = await makeUser("m8b");
    const co = await makeCompany(owner.id, "pro");
    const { code } = await createInvite(owner, co.id);
    await joinByCode(m1, code);
    await joinByCode(m2, code);

    await rejects(removeMember(m1, co.id, m2.id), 403); // a member can't remove someone else
    await removeMember(m1, co.id, m1.id); // leaving
    await removeMember(owner, co.id, m2.id); // owner removes
    await rejects(removeMember(owner, co.id, owner.id), 409);
    await rejects(removeMember(owner, co.id, m1.id), 404);
    expect((await getTeam(owner, co.id)).seatsUsed).toBe(1);
    // a removed member loses access
    await rejects(getTeam(m2, co.id), 403);
  });

  it("public company view hides billing and owner data", async () => {
    const owner = await makeUser("owner9");
    const co = await makeCompany(owner.id, "pro");
    await db.update(companies).set({ stripeCustomerId: `cus_${suffix}`, planExpiresAt: new Date() }).where(eq(companies.id, co.id));
    const view = toPublicCompany(await getCompanyById(co.id), 0);
    const json = JSON.stringify(view);
    expect(json).not.toContain("cus_");
    for (const key of ["ownerId", "stripeCustomerId", "planExpiresAt", "planSource", "currentPeriodEnd"]) {
      expect(view).not.toHaveProperty(key);
    }
    expect(view).toMatchObject({ id: co.id, openJobs: 0 });

    const mine = await getMyCompaniesWithRole(owner);
    expect(mine[0]).toMatchObject({ memberRole: "owner", stripeCustomerId: `cus_${suffix}` });
    expect(mine[0]?.planExpiresAt).toBeInstanceOf(Date);
  });
});

describe("company directory", () => {
  it("searches by name, escapes wildcards, and counts open jobs", async () => {
    const { searchCompanies } = await import("../companies/companies.queries");
    const { jobs } = await import("../../../db");
    const owner = await makeUser("owner10");
    const co = await makeCompany(owner.id, "free");
    const unique = `Zyxq${suffix}`;
    await db.update(companies).set({ name: `${unique} Studio`, industry: "Design" }).where(eq(companies.id, co.id));
    await db.insert(jobs).values([
      { companyId: co.id, title: "A", description: "d", status: "active" },
      { companyId: co.id, title: "B", description: "d", status: "draft" },
    ]);

    const hit = await searchCompanies({ q: unique.toLowerCase() });
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({ id: co.id, openJobs: 1 });
    expect(hit[0]).not.toHaveProperty("ownerId");

    expect(await searchCompanies({ q: "%" })).not.toContain(undefined); // "%" is literal, not "match everything"
    expect((await searchCompanies({ q: "%", limit: 100 })).some((c) => c.id === co.id)).toBe(false);
    expect(await searchCompanies({ q: unique, industry: "nomatch" })).toHaveLength(0);
  });
});

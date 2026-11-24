import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../../db/client";
import { companies, companyMembers, freelancerPosts, jobs, notifications, reports, users } from "../../../db";
import { countOpenReports, createReport, listReports, resolveReport } from "./reports.queries";

const suffix = randomUUID().slice(0, 8);
const userIds: string[] = [];
const companyIds: string[] = [];

async function makeUser(label: string, role: "employee" | "employer" | "admin" = "employee") {
  const [u] = await db
    .insert(users)
    .values({ supertokensUserId: `st-${suffix}-${label}`, email: `${label}-${suffix}@example.com`, role })
    .returning();
  userIds.push(u!.id);
  return u!;
}

async function makeJob(ownerId?: string) {
  const [c] = await db.insert(companies).values({ name: `Report Co ${randomUUID().slice(0, 6)}` }).returning();
  companyIds.push(c!.id);
  if (ownerId) await db.insert(companyMembers).values({ companyId: c!.id, userId: ownerId, role: "owner" });
  const [j] = await db
    .insert(jobs)
    .values({ companyId: c!.id, title: "Easy money", description: "Send a deposit first", status: "active" })
    .returning();
  return { job: j!, company: c! };
}

afterAll(async () => {
  // Reports, notifications and memberships cascade from users and companies.
  await db.delete(companies).where(inArray(companies.id, companyIds));
  await db.delete(users).where(inArray(users.id, userIds));
});

describe("reports", () => {
  it("files a report and ignores a second one from the same user on the same item", async () => {
    const reporter = await makeUser("r1");
    const { job } = await makeJob();
    const input = { targetType: "job" as const, targetId: job.id, reason: "upfront_payment" as const, note: "Asked for a deposit" };

    expect(await createReport(reporter.id, input)).toEqual({ alreadyReported: false });
    expect(await createReport(reporter.id, input)).toEqual({ alreadyReported: true });

    const rows = await db.select().from(reports).where(eq(reports.reporterId, reporter.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "open", reason: "upfront_payment", note: "Asked for a deposit" });
  });

  it("answers 404 for an item that does not exist", async () => {
    const reporter = await makeUser("r2");
    const err = await createReport(reporter.id, { targetType: "job", targetId: randomUUID(), reason: "scam" }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toMatchObject({ statusCode: 404 });
  });

  it("does not let people report their own job or their own freelancer post", async () => {
    const owner = await makeUser("owner", "employer");
    const { job } = await makeJob(owner.id);
    const own = await createReport(owner.id, { targetType: "job", targetId: job.id, reason: "spam" }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(own).toMatchObject({ statusCode: 400 });

    const freelancer = await makeUser("free");
    const [post] = await db.insert(freelancerPosts).values({ userId: freelancer.id, title: "Logos", description: "I draw", contactEmail: "a@example.com" }).returning();
    const ownPost = await createReport(freelancer.id, { targetType: "freelancer_post", targetId: post!.id, reason: "spam" }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(ownPost).toMatchObject({ statusCode: 400 });
  });

  it("lists reports with a summary of what was reported", async () => {
    const reporter = await makeUser("r3");
    const { job, company } = await makeJob();
    await createReport(reporter.id, { targetType: "job", targetId: job.id, reason: "scam" });
    await createReport(reporter.id, { targetType: "company", targetId: company.id, reason: "fake" });

    const list = await listReports({ status: "open", limit: 100, offset: 0 });
    const mine = list.filter((r) => r.reporterEmail === reporter.email);
    expect(mine).toHaveLength(2);
    expect(mine.find((r) => r.targetType === "job")?.target).toMatchObject({ title: "Easy money", exists: true });
    expect(mine.find((r) => r.targetType === "company")?.target.title).toBe(company.name);
    expect(await countOpenReports()).toBeGreaterThanOrEqual(2);
  });

  it("a takedown closes the job, settles every open report on it and notifies each reporter", async () => {
    const admin = await makeUser("admin", "admin");
    const a = await makeUser("ra");
    const b = await makeUser("rb");
    const { job } = await makeJob();
    await createReport(a.id, { targetType: "job", targetId: job.id, reason: "scam" });
    await createReport(b.id, { targetType: "job", targetId: job.id, reason: "upfront_payment" });
    const [first] = await db.select().from(reports).where(and(eq(reports.targetId, job.id), eq(reports.reporterId, a.id)));

    const out = await resolveReport(first!.id, admin.id, { status: "actioned", takedown: true, note: "Confirmed scam" });

    expect(out.resolvedCount).toBe(2);
    const [after] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(after!.status).toBe("closed");
    const rows = await db.select().from(reports).where(eq(reports.targetId, job.id));
    expect(rows.every((r) => r.status === "actioned" && r.resolvedBy === admin.id)).toBe(true);
    for (const u of [a, b]) {
      const n = await db.select().from(notifications).where(and(eq(notifications.userId, u.id), eq(notifications.type, "report_resolved")));
      expect(n).toHaveLength(1);
    }
  });

  it("dismissing leaves the item alone and only settles that report", async () => {
    const admin = await makeUser("admin2", "admin");
    const reporter = await makeUser("rd");
    const { job } = await makeJob();
    await createReport(reporter.id, { targetType: "job", targetId: job.id, reason: "other" });
    const [report] = await db.select().from(reports).where(eq(reports.reporterId, reporter.id));

    await resolveReport(report!.id, admin.id, { status: "dismissed", takedown: false });

    const [after] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(after!.status).toBe("active");
    const [resolved] = await db.select().from(reports).where(eq(reports.id, report!.id));
    expect(resolved!.status).toBe("dismissed");
  });

  it("refuses to resolve twice, to take down a company, or to take down as dismissed", async () => {
    const admin = await makeUser("admin3", "admin");
    const reporter = await makeUser("re");
    const { job, company } = await makeJob();
    await createReport(reporter.id, { targetType: "job", targetId: job.id, reason: "scam" });
    await createReport(reporter.id, { targetType: "company", targetId: company.id, reason: "fake" });
    const rows = await db.select().from(reports).where(eq(reports.reporterId, reporter.id));
    const jobReport = rows.find((r) => r.targetType === "job")!;
    const companyReport = rows.find((r) => r.targetType === "company")!;

    const wrong = await resolveReport(jobReport.id, admin.id, { status: "dismissed", takedown: true }).then(() => null, (e: unknown) => e);
    expect(wrong).toMatchObject({ statusCode: 400 });
    const comp = await resolveReport(companyReport.id, admin.id, { status: "actioned", takedown: true }).then(() => null, (e: unknown) => e);
    expect(comp).toMatchObject({ statusCode: 400 });

    await resolveReport(jobReport.id, admin.id, { status: "dismissed", takedown: false });
    const twice = await resolveReport(jobReport.id, admin.id, { status: "dismissed", takedown: false }).then(() => null, (e: unknown) => e);
    expect(twice).toMatchObject({ statusCode: 409 });
  });
});

import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../../db/client";
import { companies, companyMembers, jobs, reports, users } from "../../../db";
import type { RequestingUser } from "../companies/companies.queries";
import { listReports, resolveReport } from "../reports/reports.queries";
import { UNVERIFIED_DAILY_JOB_LIMIT, createJob, getJobWithCompanyById, searchJobs, updateJob } from "./jobs.queries";

const admin: RequestingUser = { id: randomUUID(), role: "admin" };
const suffix = randomUUID().slice(0, 8);
const companyIds: string[] = [];
const userIds: string[] = [];

async function makeCompany(verified = false) {
  const [c] = await db
    .insert(companies)
    .values({ name: `Trust Co ${randomUUID().slice(0, 6)}`, isVerified: verified, planTier: "pro" })
    .returning();
  companyIds.push(c!.id);
  return c!;
}

async function makeOwner(companyId: string, label: string): Promise<RequestingUser> {
  const [u] = await db
    .insert(users)
    .values({ supertokensUserId: `st-${suffix}-${label}`, email: `${label}-${suffix}@example.com`, role: "employer" })
    .returning();
  userIds.push(u!.id);
  await db.insert(companyMembers).values({ companyId, userId: u!.id, role: "owner" });
  return { id: u!.id, role: "employer" };
}

async function makeAdminUser(label: string) {
  const [u] = await db
    .insert(users)
    .values({ supertokensUserId: `st-${suffix}-${label}`, email: `${label}-${suffix}@example.com`, role: "admin" })
    .returning();
  userIds.push(u!.id);
  return u!;
}

const systemReports = (jobId: string) =>
  db.select().from(reports).where(and(eq(reports.targetId, jobId), isNull(reports.reporterId)));

afterAll(async () => {
  await db.delete(companies).where(inArray(companies.id, companyIds));
  await db.delete(users).where(inArray(users.id, userIds));
});

describe("verified badge data", () => {
  it("tells list and detail whether the company is verified", async () => {
    const verified = await makeCompany(true);
    const plain = await makeCompany(false);
    const a = await createJob(admin, { companyId: verified.id, title: "Verified job", description: "Normal posting", status: "active" });
    const b = await createJob(admin, { companyId: plain.id, title: "Plain job", description: "Normal posting", status: "active" });

    expect((await getJobWithCompanyById(a.id)).company.isVerified).toBe(true);
    expect((await getJobWithCompanyById(b.id)).company.isVerified).toBe(false);

    const list = await searchJobs({ q: "Verified job", limit: 20 });
    expect(list.find((j) => j.id === a.id)?.company.isVerified).toBe(true);
  });
});

describe("upfront-payment flag", () => {
  it("files one system report for a live posting that asks for money first", async () => {
    const c = await makeCompany();
    const job = await createJob(admin, {
      companyId: c.id,
      title: "Ayudante",
      description: "Salario alto. Debes hacer un pago por adelantado de 30 USD para empezar.",
      status: "active",
    });

    const rows = await systemReports(job.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: "upfront_payment", status: "open", targetType: "job", reporterId: null });

    // Editing the posting again does not pile up duplicates while the first is still open.
    await updateJob(admin, job.id, { title: "Ayudante de cocina" });
    expect(await systemReports(job.id)).toHaveLength(1);

    // The admin queue shows it (with no reporter) and an admin can take the job down without a notification to send.
    const adminUser = await makeAdminUser("flagadmin");
    const listed = (await listReports({ status: "open", limit: 100, offset: 0 })).find((r) => r.id === rows[0]!.id);
    expect(listed).toMatchObject({ reporterEmail: null, target: { exists: true } });
    await expect(resolveReport(rows[0]!.id, adminUser.id, { status: "actioned", takedown: true })).resolves.toEqual({ resolvedCount: 1 });
    expect((await getJobWithCompanyById(job.id).catch(() => null))?.id).toBe(job.id);
    const [after] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(after!.status).toBe("closed");
  });

  it("leaves honest postings, denials and drafts alone", async () => {
    const c = await makeCompany();
    const honest = await createJob(admin, { companyId: c.id, title: "Cocinero", description: "Pago mensual por transferencia.", status: "active" });
    const denial = await createJob(admin, { companyId: c.id, title: "Chofer", description: "No pedimos pago por adelantado.", status: "active" });
    const draft = await createJob(admin, { companyId: c.id, title: "Borrador", description: "Cuota para empezar: 20 MLC", status: "draft" });

    for (const j of [honest, denial, draft]) expect(await systemReports(j.id)).toHaveLength(0);
  });

  it("flags a draft once it goes live", async () => {
    const c = await makeCompany();
    const draft = await createJob(admin, { companyId: c.id, title: "Ayudante", description: "Cuota para empezar: 20 MLC", status: "draft" });
    expect(await systemReports(draft.id)).toHaveLength(0);

    await updateJob(admin, draft.id, { status: "active" });
    expect(await systemReports(draft.id)).toHaveLength(1);
  });
});

describe("posting speed limit for unverified companies", () => {
  it("stops the 6th job in a day, but not for a verified company or an admin", async () => {
    const plain = await makeCompany(false);
    const owner = await makeOwner(plain.id, "fast");
    for (let i = 0; i < UNVERIFIED_DAILY_JOB_LIMIT; i++) {
      await createJob(owner, { companyId: plain.id, title: `Draft ${i}`, description: "ok", status: "draft" });
    }
    await expect(createJob(owner, { companyId: plain.id, title: "One too many", description: "ok", status: "draft" })).rejects.toMatchObject({
      statusCode: 429,
    });
    // An admin acting for the company is not throttled.
    await expect(createJob(admin, { companyId: plain.id, title: "Admin post", description: "ok", status: "draft" })).resolves.toBeTruthy();

    const verified = await makeCompany(true);
    const vOwner = await makeOwner(verified.id, "verifiedfast");
    for (let i = 0; i < UNVERIFIED_DAILY_JOB_LIMIT + 2; i++) {
      await createJob(vOwner, { companyId: verified.id, title: `V ${i}`, description: "ok", status: "draft" });
    }
  });
});

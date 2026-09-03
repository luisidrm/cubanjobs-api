import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../../db/client";
import { companies, jobs, users } from "../../../db";
import { AppError } from "../../lib/AppError";
import { applyToJob, getApplicationsForJob, getMyApplications } from "./applications.queries";
import type { RequestingUser } from "../companies/companies.queries";

const admin: RequestingUser = { id: randomUUID(), role: "admin" };

const suffix = randomUUID().slice(0, 8);
const seededCvUrl = `cv/${suffix}/resume.pdf`;

let companyId: string;
let activeJobId: string;
let draftJobId: string;
let applicantWithCvId: string;
let applicantNoCvId: string;

beforeAll(async () => {
  const [company] = await db.insert(companies).values({ name: `Test Co ${suffix}` }).returning();
  companyId = company!.id;

  const [activeJob] = await db
    .insert(jobs)
    .values({ companyId, title: "Active job", description: "desc", status: "active" })
    .returning();
  activeJobId = activeJob!.id;

  const [draftJob] = await db
    .insert(jobs)
    .values({ companyId, title: "Draft job", description: "desc", status: "draft" })
    .returning();
  draftJobId = draftJob!.id;

  const [applicantWithCv] = await db
    .insert(users)
    .values({
      supertokensUserId: `st-${suffix}-1`,
      email: `applicant-cv-${suffix}@example.com`,
      role: "employee",
      cvUrl: seededCvUrl,
    })
    .returning();
  applicantWithCvId = applicantWithCv!.id;

  const [applicantNoCv] = await db
    .insert(users)
    .values({
      supertokensUserId: `st-${suffix}-2`,
      email: `applicant-nocv-${suffix}@example.com`,
      role: "employee",
    })
    .returning();
  applicantNoCvId = applicantNoCv!.id;
});

afterAll(async () => {
  // Deleting the company cascades its jobs, which cascades their
  // applications; deleting the users cascades any of their own rows too.
  await db.delete(companies).where(eq(companies.id, companyId));
  await db.delete(users).where(eq(users.id, applicantWithCvId));
  await db.delete(users).where(eq(users.id, applicantNoCvId));
});

describe("applyToJob", () => {
  it("creates an application using the applicant's profile cvUrl when no resumeUrl is given", async () => {
    const application = await applyToJob(applicantWithCvId, { jobId: activeJobId });
    expect(application.resumeUrl).toBe(seededCvUrl);
    expect(application.userId).toBe(applicantWithCvId);
    expect(application.status).toBe("pending");
  });

  it("rejects a duplicate application to the same job", async () => {
    await expect(applyToJob(applicantWithCvId, { jobId: activeJobId })).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("rejects applying to a job that isn't active", async () => {
    await expect(applyToJob(applicantNoCvId, { jobId: draftJobId })).rejects.toMatchObject(
      new AppError(400, "This job is not currently accepting applications")
    );
  });

  it("rejects an applicant with no cvUrl and no explicit resumeUrl", async () => {
    await expect(applyToJob(applicantNoCvId, { jobId: activeJobId })).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

describe("resumeUrl resolution on read", () => {
  it("getApplicationsForJob resolves a raw MinIO object key into a fetchable URL", async () => {
    const results = await getApplicationsForJob(admin, activeJobId);
    const mine = results.find((a) => a.applicant.id === applicantWithCvId);
    expect(mine).toBeDefined();
    expect(mine!.resumeUrl).toMatch(/^https?:\/\//);
  });

  it("getMyApplications resolves the same way for the applicant's own view", async () => {
    const results = await getMyApplications(applicantWithCvId);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.resumeUrl).toMatch(/^https?:\/\//);
  });
});

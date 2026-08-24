import { and, eq, sql } from "drizzle-orm";
import { db } from "../../../db/client";
import { jobs, jobTags, companies, type Job } from "../../../db";
import { AppError } from "../../lib/AppError";
import type { CreateJobInput, UpdateJobInput } from "./jobs.schemas";
import { assertCanManage, getCompanyById, type RequestingUser } from "../companies/companies.queries";

export interface JobSearchFilters {
  q?: string;
  isRemote?: boolean;
  location?: string;
  currency?: string;
  jobType?: string;
  tagIds?: string[];
  limit?: number;
  offset?: number;
}

export interface JobWithCompany {
  id: string;
  title: string;
  description: string;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: Job["currency"];
  location: string | null;
  jobType: Job["jobType"];
  isRemote: boolean;
  viewCount: number;
  createdAt: Date;
  company: { id: string; name: string; logoUrl: string | null };
}

export async function searchJobs(filters: JobSearchFilters): Promise<JobWithCompany[]> {
  const conditions = [eq(jobs.status, "active")];

  if (filters.q) {
    conditions.push(
      sql`to_tsvector('english', ${jobs.title} || ' ' || ${jobs.description}) @@ to_tsquery('english', ${toTsQueryParam(filters.q)})`
    );
  }
  if (filters.isRemote !== undefined) conditions.push(eq(jobs.isRemote, filters.isRemote));
  if (filters.location) conditions.push(eq(jobs.location, filters.location));
  if (filters.currency) conditions.push(eq(jobs.currency, filters.currency as "CUP" | "MLC" | "USD"));
  if (filters.jobType) {
    conditions.push(
      eq(
        jobs.jobType,
        filters.jobType as "full_time" | "part_time" | "contract" | "freelance" | "internship"
      )
    );
  }
  if (filters.tagIds && filters.tagIds.length > 0) {
    for (const tagId of filters.tagIds) {
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM ${jobTags}
          WHERE ${jobTags.jobId} = ${jobs.id}
          AND ${jobTags.tagId} = ${tagId}
        )`
      );
    }
  }

  const rows = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      description: jobs.description,
      salaryMin: jobs.salaryMin,
      salaryMax: jobs.salaryMax,
      currency: jobs.currency,
      location: jobs.location,
      jobType: jobs.jobType,
      isRemote: jobs.isRemote,
      viewCount: jobs.viewCount,
      createdAt: jobs.createdAt,
      companyId: companies.id,
      companyName: companies.name,
      companyLogoUrl: companies.logoUrl,
    })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(and(...conditions))
    .limit(filters.limit ?? 20)
    .offset(filters.offset ?? 0);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    salaryMin: r.salaryMin,
    salaryMax: r.salaryMax,
    currency: r.currency,
    location: r.location,
    jobType: r.jobType,
    isRemote: r.isRemote,
    viewCount: r.viewCount,
    createdAt: r.createdAt,
    company: { id: r.companyId, name: r.companyName, logoUrl: r.companyLogoUrl },
  }));
}

function toTsQueryParam(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.replace(/[^\w]/g, ""))
    .filter(Boolean)
    .join(" & ");
}

export async function getJobById(id: string): Promise<Job> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
  if (!job) throw new AppError(404, "Job not found");
  return job;
}

/** Public single-job lookup, with the company joined in for job detail views. */
export async function getJobWithCompanyById(id: string): Promise<JobWithCompany> {
  const [row] = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      description: jobs.description,
      salaryMin: jobs.salaryMin,
      salaryMax: jobs.salaryMax,
      currency: jobs.currency,
      location: jobs.location,
      jobType: jobs.jobType,
      isRemote: jobs.isRemote,
      viewCount: jobs.viewCount,
      createdAt: jobs.createdAt,
      companyId: companies.id,
      companyName: companies.name,
      companyLogoUrl: companies.logoUrl,
    })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(eq(jobs.id, id));

  if (!row) throw new AppError(404, "Job not found");

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    salaryMin: row.salaryMin,
    salaryMax: row.salaryMax,
    currency: row.currency,
    location: row.location,
    jobType: row.jobType,
    isRemote: row.isRemote,
    viewCount: row.viewCount,
    createdAt: row.createdAt,
    company: { id: row.companyId, name: row.companyName, logoUrl: row.companyLogoUrl },
  };
}

export async function incrementViewCount(id: string): Promise<void> {
  await db
    .update(jobs)
    .set({ viewCount: sql`${jobs.viewCount} + 1` })
    .where(eq(jobs.id, id));
}

async function assertOwnsCompany(user: RequestingUser, companyId: string) {
  const company = await getCompanyById(companyId);
  await assertCanManage(company, user);
  return company;
}

/**
 * Returns all jobs for a company regardless of status (employer's own view).
 * NOW ownership-checked: only the company's owner or an admin may call this.
 */
export async function getJobsByCompany(
  user: RequestingUser,
  companyId: string
): Promise<Job[]> {
  await assertOwnsCompany(user, companyId);
  return db.select().from(jobs).where(eq(jobs.companyId, companyId));
}

export async function createJob(user: RequestingUser, input: CreateJobInput): Promise<Job> {
  await assertOwnsCompany(user, input.companyId);
  const [job] = await db.insert(jobs).values(input).returning();
  if (!job) throw new AppError(500, "Failed to create job");
  return job;
}

export async function updateJob(
  user: RequestingUser,
  jobId: string,
  input: UpdateJobInput
): Promise<Job> {
  const job = await getJobById(jobId);
  await assertOwnsCompany(user, job.companyId);
  const [updated] = await db.update(jobs).set(input).where(eq(jobs.id, jobId)).returning();
  if (!updated) throw new AppError(500, "Failed to update job");
  return updated;
}

export async function deleteJob(user: RequestingUser, jobId: string): Promise<void> {
  const job = await getJobById(jobId);
  await assertOwnsCompany(user, job.companyId);
  await db.delete(jobs).where(eq(jobs.id, jobId));
}
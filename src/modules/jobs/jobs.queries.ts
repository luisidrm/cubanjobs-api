import { and, eq, sql } from "drizzle-orm";
import { db } from "../../../db/client";
import { jobs, jobTags, companies, type Job } from "../../../db";
import { AppError } from "../../lib/AppError";
import type { CreateJobInput, UpdateJobInput } from "./jobs.schemas";
import type { RequestingUser } from "../companies/companies.queries";

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

export async function searchJobs(filters: JobSearchFilters): Promise<Job[]> {
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

  return db
    .select()
    .from(jobs)
    .where(and(...conditions))
    .limit(filters.limit ?? 20)
    .offset(filters.offset ?? 0);
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

export async function incrementViewCount(id: string): Promise<void> {
  await db
    .update(jobs)
    .set({ viewCount: sql`${jobs.viewCount} + 1` })
    .where(eq(jobs.id, id));
}

async function assertOwnsCompany(user: RequestingUser, companyId: string) {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company) throw new AppError(404, "Company not found");
  if (user.role !== "admin" && company.ownerId !== user.id) {
    throw new AppError(403, "You do not have permission to manage jobs for this company");
  }
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
  return updated;
}

export async function deleteJob(user: RequestingUser, jobId: string): Promise<void> {
  const job = await getJobById(jobId);
  await assertOwnsCompany(user, job.companyId);
  await db.delete(jobs).where(eq(jobs.id, jobId));
}
import { and, eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { savedJobs, jobs, companies } from "../../../db";
import { AppError } from "../../lib/AppError";

export interface SavedJobWithDetails {
  jobId: string;
  savedAt: Date;
  job: {
    id: string;
    title: string;
    location: string | null;
    isRemote: boolean;
    coverImageUrl: string | null;
    salaryMin: number | null;
    salaryMax: number | null;
    currency: string | null;
    company: { id: string; name: string; logoUrl: string | null };
  };
}

export async function saveJob(userId: string, jobId: string): Promise<void> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) throw new AppError(404, "Job not found");

  try {
    await db.insert(savedJobs).values({ userId, jobId });
  } catch (err: any) {
    if (err?.code === "23505") return; // already saved — idempotent
    throw err;
  }
}

export async function unsaveJob(userId: string, jobId: string): Promise<void> {
  await db
    .delete(savedJobs)
    .where(and(eq(savedJobs.userId, userId), eq(savedJobs.jobId, jobId)));
}

export async function getMySavedJobs(userId: string): Promise<SavedJobWithDetails[]> {
  const rows = await db
    .select({
      jobId: jobs.id,
      savedAt: savedJobs.savedAt,
      title: jobs.title,
      location: jobs.location,
      isRemote: jobs.isRemote,
      coverImageUrl: jobs.coverImageUrl,
      salaryMin: jobs.salaryMin,
      salaryMax: jobs.salaryMax,
      currency: jobs.currency,
      companyId: companies.id,
      companyName: companies.name,
      companyLogoUrl: companies.logoUrl,
    })
    .from(savedJobs)
    .innerJoin(jobs, eq(savedJobs.jobId, jobs.id))
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(eq(savedJobs.userId, userId));

  return rows.map((r) => ({
    jobId: r.jobId,
    savedAt: r.savedAt,
    job: {
      id: r.jobId,
      title: r.title,
      location: r.location,
      isRemote: r.isRemote,
      coverImageUrl: r.coverImageUrl,
      salaryMin: r.salaryMin,
      salaryMax: r.salaryMax,
      currency: r.currency,
      company: { id: r.companyId, name: r.companyName, logoUrl: r.companyLogoUrl },
    },
  }));
}
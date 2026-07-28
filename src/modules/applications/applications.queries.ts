import { and, eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { applications, jobs, companies, users, type Application } from "../../../db";
import { AppError } from "../../lib/AppError";
import type {
  ApplyToJobInput,
  UpdateApplicationStatusInput,
  UpdateApplicationNotesInput,
} from "./applications.schemas";
import type { RequestingUser } from "../companies/companies.queries";

/**
 * Applies to a job on behalf of the given user.
 * - Job must exist and be "active"
 * - Applicant must have a resume, either supplied here or on their profile
 * - Duplicate applications are rejected with a clean 409 (unique constraint backs this up at the DB level)
 */
export async function applyToJob(
  applicantId: string,
  input: ApplyToJobInput
): Promise<Application> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, input.jobId));
  if (!job) throw new AppError(404, "Job not found");
  if (job.status !== "active") {
    throw new AppError(400, "This job is not currently accepting applications");
  }

  let resumeUrl = input.resumeUrl;
  if (!resumeUrl) {
    const [applicant] = await db
      .select({ cvUrl: users.cvUrl })
      .from(users)
      .where(eq(users.id, applicantId));
    resumeUrl = applicant?.cvUrl ?? undefined;
  }

  if (!resumeUrl) {
    throw new AppError(
      400,
      "No resume provided. Upload a CV to your profile or supply resumeUrl."
    );
  }

  const [existing] = await db
    .select()
    .from(applications)
    .where(
      and(eq(applications.userId, applicantId), eq(applications.jobId, input.jobId))
    );
  if (existing) {
    throw new AppError(409, "You have already applied to this job");
  }

  try {
    const [application] = await db
      .insert(applications)
      .values({
        userId: applicantId,
        jobId: input.jobId,
        coverLetter: input.coverLetter,
        resumeUrl,
      })
      .returning();
    return application;
  } catch (err: any) {
    // Fallback in case of a race between the check above and the insert
    if (err?.code === "23505") {
      throw new AppError(409, "You have already applied to this job");
    }
    throw err;
  }
}

export async function getMyApplications(userId: string): Promise<Application[]> {
  return db.select().from(applications).where(eq(applications.userId, userId));
}

export async function getApplicationById(id: string): Promise<Application> {
  const [application] = await db.select().from(applications).where(eq(applications.id, id));
  if (!application) throw new AppError(404, "Application not found");
  return application;
}

/**
 * Checks whether the requesting user may view/manage this application:
 * the applicant themself, the owner of the job's company, or an admin.
 * Returns the application if allowed, throws 403/404 otherwise.
 */
export async function assertCanAccessApplication(
  user: RequestingUser,
  applicationId: string
): Promise<Application> {
  const application = await getApplicationById(applicationId);

  if (user.role === "admin") return application;
  if (application.userId === user.id) return application;

  const [job] = await db.select().from(jobs).where(eq(jobs.id, application.jobId));
  if (!job) throw new AppError(404, "Job not found");

  const [company] = await db.select().from(companies).where(eq(companies.id, job.companyId));
  if (!company) throw new AppError(404, "Company not found");

  if (company.ownerId !== user.id) {
    throw new AppError(403, "You do not have permission to access this application");
  }

  return application;
}

/**
 * Checks whether the requesting user owns the company behind a job,
 * and returns all applications for that job. Admins bypass the check.
 */
export async function getApplicationsForJob(
  user: RequestingUser,
  jobId: string
): Promise<Application[]> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) throw new AppError(404, "Job not found");

  if (user.role !== "admin") {
    const [company] = await db.select().from(companies).where(eq(companies.id, job.companyId));
    if (!company) throw new AppError(404, "Company not found");
    if (company.ownerId !== user.id) {
      throw new AppError(403, "You do not have permission to view applicants for this job");
    }
  }

  return db.select().from(applications).where(eq(applications.jobId, jobId));
}

export async function updateApplicationStatus(
  user: RequestingUser,
  applicationId: string,
  input: UpdateApplicationStatusInput
): Promise<Application> {
  // Employer/admin only — applicants withdraw via a separate path (remove), not this one
  const application = await getApplicationById(applicationId);

  const [job] = await db.select().from(jobs).where(eq(jobs.id, application.jobId));
  if (!job) throw new AppError(404, "Job not found");

  if (user.role !== "admin") {
    const [company] = await db.select().from(companies).where(eq(companies.id, job.companyId));
    if (!company) throw new AppError(404, "Company not found");
    if (company.ownerId !== user.id) {
      throw new AppError(403, "You do not have permission to update this application");
    }
  }

  const [updated] = await db
    .update(applications)
    .set({ status: input.status })
    .where(eq(applications.id, applicationId))
    .returning();
  return updated;
}

export async function updateApplicationNotes(
  user: RequestingUser,
  applicationId: string,
  input: UpdateApplicationNotesInput
): Promise<Application> {
  const application = await getApplicationById(applicationId);

  const [job] = await db.select().from(jobs).where(eq(jobs.id, application.jobId));
  if (!job) throw new AppError(404, "Job not found");

  if (user.role !== "admin") {
    const [company] = await db.select().from(companies).where(eq(companies.id, job.companyId));
    if (!company) throw new AppError(404, "Company not found");
    if (company.ownerId !== user.id) {
      throw new AppError(403, "You do not have permission to update this application");
    }
  }

  const [updated] = await db
    .update(applications)
    .set({ employerNotes: input.employerNotes })
    .where(eq(applications.id, applicationId))
    .returning();
  return updated;
}

/** Applicant withdraws their own application — sets status rather than deleting, to preserve history. */
export async function withdrawApplication(
  user: RequestingUser,
  applicationId: string
): Promise<Application> {
  const application = await getApplicationById(applicationId);

  if (user.role !== "admin" && application.userId !== user.id) {
    throw new AppError(403, "You can only withdraw your own applications");
  }

  const [updated] = await db
    .update(applications)
    .set({ status: "withdrawn" })
    .where(eq(applications.id, applicationId))
    .returning();
  return updated;
}
import { and, eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { applications, jobs, companies, users, type Application } from "../../../db";
import { AppError } from "../../lib/AppError";
import { enqueueApplicationStatusNotification } from "../../lib/queue";
import { insertNotification } from "../notifications/notifications.queries";
import type {
  ApplyToJobInput,
  UpdateApplicationStatusInput,
  UpdateApplicationNotesInput,
} from "./applications.schemas";
import { assertCanManage, type RequestingUser } from "../companies/companies.queries";

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
    if (!application) throw new AppError(500, "Failed to create application");
    return application;
  } catch (err: any) {
    // Fallback in case of a race between the check above and the insert
    if (err?.code === "23505") {
      throw new AppError(409, "You have already applied to this job");
    }
    throw err;
  }
}

export interface ApplicationWithJob {
  id: string;
  status: Application["status"];
  coverLetter: string | null;
  resumeUrl: string;
  createdAt: Date;
  job: {
    id: string;
    title: string;
    company: { id: string; name: string };
  };
}

export async function getMyApplications(userId: string): Promise<ApplicationWithJob[]> {
  const rows = await db
    .select({
      id: applications.id,
      status: applications.status,
      coverLetter: applications.coverLetter,
      resumeUrl: applications.resumeUrl,
      createdAt: applications.createdAt,
      jobId: jobs.id,
      jobTitle: jobs.title,
      companyId: companies.id,
      companyName: companies.name,
    })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(eq(applications.userId, userId));

  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    coverLetter: r.coverLetter,
    resumeUrl: r.resumeUrl,
    createdAt: r.createdAt,
    job: {
      id: r.jobId,
      title: r.jobTitle,
      company: { id: r.companyId, name: r.companyName },
    },
  }));
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

  await assertCanManage(company, user);

  return application;
}

export interface ApplicationWithApplicant {
  id: string;
  status: Application["status"];
  coverLetter: string | null;
  resumeUrl: string;
  employerNotes: string | null;
  createdAt: Date;
  applicant: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
    phone: string | null;
    profilePictureUrl: string | null;
  };
}

/**
 * Checks whether the requesting user owns the company behind a job,
 * and returns all applications for that job, joined with minimal
 * safe applicant profile fields (an employer needs to know who
 * applied, not just an opaque userId). Admins bypass the check.
 */
export async function getApplicationsForJob(
  user: RequestingUser,
  jobId: string
): Promise<ApplicationWithApplicant[]> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) throw new AppError(404, "Job not found");

  if (user.role !== "admin") {
    const [company] = await db.select().from(companies).where(eq(companies.id, job.companyId));
    if (!company) throw new AppError(404, "Company not found");
    await assertCanManage(company, user);
  }

  const rows = await db
    .select({
      id: applications.id,
      status: applications.status,
      coverLetter: applications.coverLetter,
      resumeUrl: applications.resumeUrl,
      employerNotes: applications.employerNotes,
      createdAt: applications.createdAt,
      applicantId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      phone: users.phone,
      profilePictureUrl: users.profilePictureUrl,
    })
    .from(applications)
    .innerJoin(users, eq(applications.userId, users.id))
    .where(eq(applications.jobId, jobId));

  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    coverLetter: r.coverLetter,
    resumeUrl: r.resumeUrl,
    employerNotes: r.employerNotes,
    createdAt: r.createdAt,
    applicant: {
      id: r.applicantId,
      firstName: r.firstName,
      lastName: r.lastName,
      email: r.email,
      phone: r.phone,
      profilePictureUrl: r.profilePictureUrl,
    },
  }));
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

  const [company] = await db.select().from(companies).where(eq(companies.id, job.companyId));
  if (!company) throw new AppError(404, "Company not found");

  await assertCanManage(company, user);

  const [updated] = await db
    .update(applications)
    .set({ status: input.status })
    .where(eq(applications.id, applicationId))
    .returning();
  if (!updated) throw new AppError(500, "Failed to update application status");

  // Persisted in-app history — synchronous with the request, unlike the
  // push/email below, since it backs the mobile app's own notification
  // inbox and must not depend on Redis/the BullMQ worker being up.
  await insertNotification({
    userId: updated.userId,
    type: "application_status_changed",
    title: `Your application to ${job.title} was updated`,
    body: `Your application at ${company.name} is now ${updated.status}.`,
    data: { applicationId: updated.id, jobId: job.id },
  });

  const [applicant] = await db
    .select({
      email: users.email,
      firstName: users.firstName,
      expoPushToken: users.expoPushToken,
    })
    .from(users)
    .where(eq(users.id, updated.userId));
  if (applicant) {
    await enqueueApplicationStatusNotification({
      applicantEmail: applicant.email,
      applicantName: applicant.firstName ?? "there",
      expoPushToken: applicant.expoPushToken,
      jobTitle: job.title,
      companyName: company.name,
      status: updated.status,
    });
  }

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
    await assertCanManage(company, user);
  }

  const [updated] = await db
    .update(applications)
    .set({ employerNotes: input.employerNotes })
    .where(eq(applications.id, applicationId))
    .returning();
  if (!updated) throw new AppError(500, "Failed to update application notes");
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
  if (!updated) throw new AppError(500, "Failed to withdraw application");
  return updated;
}
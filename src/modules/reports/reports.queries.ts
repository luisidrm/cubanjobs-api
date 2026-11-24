import { and, count, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../../db/client";
import {
  companies,
  companyMembers,
  freelancerPosts,
  jobs,
  reports,
  users,
  type ReportTargetType,
} from "../../../db";
import { AppError } from "../../lib/AppError";
import { insertNotification } from "../notifications/notifications.queries";
import type { CreateReportInput, ListReportsQuery, ResolveReportInput } from "./reports.schemas";

/** Whether the user owns the reported item, so people can't report their own content. */
async function userOwnsTarget(type: ReportTargetType, id: string, userId: string): Promise<boolean> {
  if (type === "freelancer_post") {
    const [post] = await db.select({ userId: freelancerPosts.userId }).from(freelancerPosts).where(eq(freelancerPosts.id, id));
    if (!post) throw new AppError(404, "Item not found");
    return post.userId === userId;
  }
  let companyId: string;
  if (type === "job") {
    const [job] = await db.select({ companyId: jobs.companyId }).from(jobs).where(eq(jobs.id, id));
    if (!job) throw new AppError(404, "Item not found");
    companyId = job.companyId;
  } else {
    const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, id));
    if (!company) throw new AppError(404, "Item not found");
    companyId = company.id;
  }
  const [member] = await db
    .select({ userId: companyMembers.userId })
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId)));
  return !!member;
}

/** Files a report. Reporting the same item twice is not an error and does not add a second row. */
export async function createReport(reporterId: string, input: CreateReportInput): Promise<{ alreadyReported: boolean }> {
  if (await userOwnsTarget(input.targetType, input.targetId, reporterId)) {
    throw new AppError(400, "You can't report your own content");
  }
  const inserted = await db
    .insert(reports)
    .values({
      reporterId,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      note: input.note ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: reports.id });
  return { alreadyReported: inserted.length === 0 };
}

async function targetSummaries(rows: { targetType: ReportTargetType; targetId: string }[]) {
  const idsOf = (t: ReportTargetType) => rows.filter((r) => r.targetType === t).map((r) => r.targetId);
  const out = new Map<string, { title: string; exists: boolean; extra?: string }>();

  const jobIds = idsOf("job");
  if (jobIds.length) {
    const found = await db
      .select({ id: jobs.id, title: jobs.title, status: jobs.status, company: companies.name })
      .from(jobs)
      .innerJoin(companies, eq(jobs.companyId, companies.id))
      .where(inArray(jobs.id, jobIds));
    for (const j of found) out.set(`job:${j.id}`, { title: j.title, exists: true, extra: `${j.company} · ${j.status}` });
  }

  const postIds = idsOf("freelancer_post");
  if (postIds.length) {
    const found = await db
      .select({ id: freelancerPosts.id, title: freelancerPosts.title })
      .from(freelancerPosts)
      .where(inArray(freelancerPosts.id, postIds));
    for (const p of found) out.set(`freelancer_post:${p.id}`, { title: p.title, exists: true });
  }

  const companyIds = idsOf("company");
  if (companyIds.length) {
    const found = await db
      .select({ id: companies.id, name: companies.name, verified: companies.isVerified })
      .from(companies)
      .where(inArray(companies.id, companyIds));
    for (const c of found) {
      out.set(`company:${c.id}`, { title: c.name, exists: true, extra: c.verified ? "verified" : "not verified" });
    }
  }
  return out;
}

export async function listReports(query: ListReportsQuery) {
  const where = query.status ? eq(reports.status, query.status) : undefined;
  const rows = await db
    .select({
      id: reports.id,
      targetType: reports.targetType,
      targetId: reports.targetId,
      reason: reports.reason,
      note: reports.note,
      status: reports.status,
      createdAt: reports.createdAt,
      resolvedAt: reports.resolvedAt,
      resolutionNote: reports.resolutionNote,
      reporterEmail: users.email,
    })
    .from(reports)
    .innerJoin(users, eq(reports.reporterId, users.id))
    .where(where)
    .orderBy(desc(reports.createdAt), desc(reports.id))
    .limit(query.limit)
    .offset(query.offset);

  const summaries = await targetSummaries(rows);
  return rows.map((r) => ({
    ...r,
    target: summaries.get(`${r.targetType}:${r.targetId}`) ?? { title: "(removed)", exists: false },
  }));
}

export async function countOpenReports(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(reports).where(eq(reports.status, "open"));
  return row?.n ?? 0;
}

const REASON_LABEL: Record<string, string> = {
  scam: "a scam",
  upfront_payment: "a request for upfront payment",
  inappropriate: "inappropriate content",
  spam: "spam",
  fake: "a fake listing",
  other: "a problem",
};

/**
 * Resolves a report. With takedown, the item is hidden (job closed, freelancer post deleted) and every
 * other open report on it is settled the same way. Each reporter gets a notification.
 */
export async function resolveReport(reportId: string, adminId: string, input: ResolveReportInput) {
  const [report] = await db.select().from(reports).where(eq(reports.id, reportId));
  if (!report) throw new AppError(404, "Report not found");
  if (report.status !== "open") throw new AppError(409, "This report is already resolved");
  if (input.takedown && input.status !== "actioned") {
    throw new AppError(400, "A takedown must be marked as actioned");
  }
  if (input.takedown && report.targetType === "company") {
    throw new AppError(400, "Companies can't be taken down from here; unverify or contact the owner instead");
  }

  const resolved = await db.transaction(async (tx) => {
    if (input.takedown) {
      if (report.targetType === "job") {
        await tx.update(jobs).set({ status: "closed" }).where(eq(jobs.id, report.targetId));
      } else if (report.targetType === "freelancer_post") {
        await tx.delete(freelancerPosts).where(eq(freelancerPosts.id, report.targetId));
      }
    }
    const scope = input.takedown
      ? and(eq(reports.targetType, report.targetType), eq(reports.targetId, report.targetId), eq(reports.status, "open"))
      : eq(reports.id, reportId);
    return tx
      .update(reports)
      .set({ status: input.status, resolvedBy: adminId, resolvedAt: new Date(), resolutionNote: input.note ?? null })
      .where(scope)
      .returning({ id: reports.id, reporterId: reports.reporterId, reason: reports.reason });
  });

  const actioned = input.status === "actioned";
  await Promise.all(
    resolved.map((r) =>
      insertNotification({
        userId: r.reporterId,
        type: "report_resolved",
        title: actioned ? "We took action on your report" : "We reviewed your report",
        body: actioned
          ? `Thanks for flagging ${REASON_LABEL[r.reason] ?? "a problem"}. We acted on it.`
          : `Thanks for flagging ${REASON_LABEL[r.reason] ?? "a problem"}. We reviewed it and found nothing to remove.`,
        data: { reportId: r.id, status: input.status },
      }),
    ),
  );
  return { resolvedCount: resolved.length };
}

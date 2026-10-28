import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "../../../db/client";
import { companies, companyMembers, jobs, type Company } from "../../../db";
import { AppError } from "../../lib/AppError";
import type { CompanySearchQuery, CreateCompanyInput, UpdateCompanyInput } from "./companies.schemas";
import type { UserRole } from "../../../db/schema/users";

export interface RequestingUser {
  id: string;
  role: UserRole;
}

export async function createCompany(
  ownerId: string,
  input: CreateCompanyInput
): Promise<Company> {
  return db.transaction(async (tx) => {
    const [company] = await tx
      .insert(companies)
      .values({ ...input, ownerId })
      .returning();
    if (!company) throw new AppError(500, "Failed to create company");
    await tx.insert(companyMembers).values({ companyId: company.id, userId: ownerId, role: "owner" });
    return company;
  });
}

export async function getCompanyById(id: string): Promise<Company> {
  const [company] = await db.select().from(companies).where(eq(companies.id, id));
  if (!company) throw new AppError(404, "Company not found");
  return company;
}

/**
 * What anyone (including guests) may see of a company. Billing state, Stripe
 * ids and the owner id stay private: they're only returned by `GET /companies/my`.
 */
export function toPublicCompany(company: Company, openJobs: number) {
  return {
    id: company.id,
    name: company.name,
    description: company.description,
    website: company.website,
    logoUrl: company.logoUrl,
    industry: company.industry,
    employeeCount: company.employeeCount,
    location: company.location,
    isVerified: company.isVerified,
    planTier: company.planTier,
    openJobs,
    createdAt: company.createdAt,
  };
}

export async function countOpenJobs(companyId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(jobs)
    .where(and(eq(jobs.companyId, companyId), eq(jobs.status, "active")));
  return row?.n ?? 0;
}

/** Contains-match pattern with LIKE wildcards in the user's text escaped. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Public company directory: name/industry/location search, most open jobs first. */
export async function searchCompanies(filters: CompanySearchQuery) {
  const conditions = [];
  if (filters.q) {
    const like = likePattern(filters.q);
    conditions.push(or(ilike(companies.name, like), ilike(companies.description, like), ilike(companies.industry, like)));
  }
  if (filters.industry) conditions.push(ilike(companies.industry, likePattern(filters.industry)));
  if (filters.location) conditions.push(ilike(companies.location, likePattern(filters.location)));
  // Table names are written out: Drizzle drops the qualifier inside a single-table select, which would turn the correlation into jobs.company_id = jobs.id.
  const openJobs = sql<number>`(SELECT count(*)::int FROM jobs j WHERE j.company_id = companies.id AND j.status = 'active')`;
  const rows = await db
    .select({ company: companies, openJobs })
    .from(companies)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(openJobs), companies.name)
    .limit(filters.limit ?? 20)
    .offset(filters.offset ?? 0);
  return rows.map((r) => toPublicCompany(r.company, r.openJobs));
}

/** The caller's companies with their role in each (owner sees billing dates; members don't). */
export async function getMyCompaniesWithRole(user: RequestingUser) {
  const rows = await db
    .select({ company: companies, memberRole: companyMembers.role })
    .from(companyMembers)
    .innerJoin(companies, eq(companies.id, companyMembers.companyId))
    .where(eq(companyMembers.userId, user.id));
  return rows.map(({ company, memberRole }) => {
    const isOwner = memberRole === "owner";
    return {
      ...company,
      // Members never need the billing identifiers; only the owner sees renewal dates.
      stripeSubscriptionId: undefined,
      planReminderSentAt: undefined,
      stripeCustomerId: isOwner ? company.stripeCustomerId : null,
      stripeSubscriptionStatus: isOwner ? company.stripeSubscriptionStatus : null,
      currentPeriodEnd: isOwner ? company.currentPeriodEnd : null,
      planExpiresAt: isOwner ? company.planExpiresAt : null,
      memberRole: isOwner ? ("owner" as const) : ("member" as const),
    };
  });
}

export async function getCompaniesByOwner(userId: string): Promise<Company[]> {
  return db
    .select()
    .from(companies)
    .where(
      inArray(
        companies.id,
        db.select({ id: companyMembers.companyId }).from(companyMembers).where(eq(companyMembers.userId, userId))
      )
    );
}

/** Single source of truth for "can this user manage this company" — also used
 * by the jobs and uploads modules so ownership is checked identically everywhere. */
export async function assertCanManage(company: Company, user: RequestingUser): Promise<void> {
  if (user.role === "admin") return;
  const [membership] = await db
    .select()
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, company.id), eq(companyMembers.userId, user.id)));
  if (!membership) {
    throw new AppError(403, "You do not have permission to manage this company");
  }
}

/** Owner of the company (or a platform admin): team, plan/billing and deletion are theirs alone. */
export async function isCompanyOwner(companyId: string, user: RequestingUser): Promise<boolean> {
  if (user.role === "admin") return true;
  const [m] = await db
    .select({ role: companyMembers.role })
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, user.id)));
  return m?.role === "owner";
}

export async function assertCompanyOwner(company: Company, user: RequestingUser): Promise<void> {
  if (!(await isCompanyOwner(company.id, user))) {
    throw new AppError(403, "Only the company owner can do this");
  }
}

export async function updateCompany(
  user: RequestingUser,
  id: string,
  input: UpdateCompanyInput
): Promise<Company> {
  const company = await getCompanyById(id);
  await assertCanManage(company, user);
  const [updated] = await db
    .update(companies)
    .set(input)
    .where(eq(companies.id, id))
    .returning();
  if (!updated) throw new AppError(500, "Failed to update company");
  return updated;
}

/** Callers that have already resolved and authorized the company (e.g. uploads.controller,
 * which needs the company row up front to know the old logo to delete) should use this
 * directly rather than re-fetching + re-checking via updateCompanyLogo. */
export async function setCompanyLogo(id: string, logoUrl: string): Promise<Company> {
  const [updated] = await db
    .update(companies)
    .set({ logoUrl })
    .where(eq(companies.id, id))
    .returning();
  if (!updated) throw new AppError(500, "Failed to update company logo");
  return updated;
}

export async function updateCompanyLogo(
  user: RequestingUser,
  id: string,
  logoUrl: string
): Promise<Company> {
  const company = await getCompanyById(id);
  await assertCanManage(company, user);
  return setCompanyLogo(id, logoUrl);
}

export async function deleteCompany(user: RequestingUser, id: string): Promise<void> {
  const company = await getCompanyById(id);
  await assertCompanyOwner(company, user);
  await db.delete(companies).where(eq(companies.id, id));
}
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../../db/client";
import { companies, companyMembers, type Company } from "../../../db";
import { AppError } from "../../lib/AppError";
import type { CreateCompanyInput, UpdateCompanyInput } from "./companies.schemas";
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
  await assertCanManage(company, user);
  await db.delete(companies).where(eq(companies.id, id));
}
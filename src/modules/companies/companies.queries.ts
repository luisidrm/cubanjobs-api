import { eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { companies, type Company } from "../../../db";
import { AppError } from "../../lib/AppError";
import type { CreateCompanyInput, UpdateCompanyInput } from "./companies.schemas";

export async function createCompany(
  ownerId: string,
  input: CreateCompanyInput
): Promise<Company> {
  const [company] = await db
    .insert(companies)
    .values({ ...input, ownerId })
    .returning();
  return company;
}

export async function getCompanyById(id: string): Promise<Company> {
  const [company] = await db
    .select()
    .from(companies)
    .where(eq(companies.id, id));
  if (!company) throw new AppError(404, "Company not found");
  return company;
}

export async function getCompaniesByOwner(ownerId: string): Promise<Company[]> {
  return db.select().from(companies).where(eq(companies.ownerId, ownerId));
}

export async function updateCompany(
  ownerId: string,
  id: string,
  input: UpdateCompanyInput
): Promise<Company> {
  const company = await getCompanyById(id);
  if (company.ownerId !== ownerId) {
    throw new AppError(403, "You do not own this company");
  }
  const [updated] = await db
    .update(companies)
    .set(input)
    .where(eq(companies.id, id))
    .returning();
  return updated;
}

export async function updateCompanyLogo(
  ownerId: string,
  id: string,
  logoUrl: string
): Promise<Company> {
  const company = await getCompanyById(id);
  if (company.ownerId !== ownerId) {
    throw new AppError(403, "You do not own this company");
  }
  const [updated] = await db
    .update(companies)
    .set({ logoUrl })
    .where(eq(companies.id, id))
    .returning();
  return updated;
}

export async function deleteCompany(
  ownerId: string,
  id: string
): Promise<void> {
  const company = await getCompanyById(id);
  if (company.ownerId !== ownerId) {
    throw new AppError(403, "You do not own this company");
  }
  await db.delete(companies).where(eq(companies.id, id));
}

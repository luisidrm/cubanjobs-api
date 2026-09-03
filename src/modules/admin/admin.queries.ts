import { eq, ilike } from "drizzle-orm";
import { db } from "../../../db/client";
import { companies, users, type Company, type User, type UserRole } from "../../../db";
import { AppError } from "../../lib/AppError";
import { supertokens } from "../../lib/supertokens";

export async function searchCompaniesByName(q: string): Promise<Company[]> {
  return db.select().from(companies).where(ilike(companies.name, `%${q}%`)).limit(20);
}

export async function verifyCompany(companyId: string, isVerified: boolean): Promise<Company> {
  const [updated] = await db
    .update(companies)
    .set({ isVerified })
    .where(eq(companies.id, companyId))
    .returning();
  if (!updated) throw new AppError(404, "Company not found");
  return updated;
}

export async function updateUserRole(userId: string, role: UserRole): Promise<User> {
  const [updated] = await db.update(users).set({ role }).where(eq(users.id, userId)).returning();
  if (!updated) throw new AppError(404, "User not found");
  return updated;
}

export interface UserLookupResult {
  localUser: User | null;
  supertokensUserId: string | null;
}

/**
 * Looks up a user by email across both systems — the local `users` table
 * and SuperTokens directly. A supertokensUserId with no localUser is the
 * orphaned-signup scenario (see src/lib/supertokens.ts's rollback comment):
 * signup succeeded in SuperTokens but the local profile row never got
 * created, and the rollback delete also failed.
 */
export async function lookupUserByEmail(email: string): Promise<UserLookupResult> {
  const [localUser] = await db.select().from(users).where(eq(users.email, email));

  if (localUser) {
    return { localUser, supertokensUserId: localUser.supertokensUserId };
  }

  // Same SuperTokens SDK call already used by scripts/seed.ts's
  // ensureSuperTokensUser to resolve an email to its SuperTokens user id.
  const stUsers = await supertokens.listUsersByAccountInfo("public", { email });
  const stUser = stUsers[0];
  return { localUser: null, supertokensUserId: stUser?.id ?? null };
}

export async function deleteOrphanedSupertokensUser(supertokensUserId: string): Promise<void> {
  const [localUser] = await db
    .select()
    .from(users)
    .where(eq(users.supertokensUserId, supertokensUserId));
  if (localUser) {
    throw new AppError(
      400,
      "This SuperTokens account has a matching local profile — it isn't orphaned, refusing to delete."
    );
  }
  await supertokens.deleteUser(supertokensUserId);
}

import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import supertokens from "supertokens-node";
import { db } from "../../../db/client";
import { users, userSkills, skillsCatalog, workExperience, companyMembers, type User } from "../../../db";
import { AppError } from "../../lib/AppError";
import type { UpdateUserInput, AddSkillInput, WorkerSearchQuery } from "./users.schemas";

export interface WorkerSummary {
  id: string;
  firstName: string | null;
  lastName: string | null;
  bio: string | null;
  location: string | null;
  profilePictureUrl: string | null;
  skills: { id: string; skill: string; yearsExperience: number | null }[];
}

export interface OwnUserProfile {
  id: string;
  email: string;
  role: User["role"];
  firstName: string | null;
  lastName: string | null;
  bio: string | null;
  phone: string | null;
  location: string | null;
  profilePictureUrl: string | null;
  cvUrl: string | null;
  linkedinUrl: string | null;
  expoPushToken: string | null;
  onboardingCompletedAt: Date | null;
  /** Employee plan: "paid" unlocks applying. planExpiresAt null on paid = no expiry. */
  plan: User["plan"];
  planExpiresAt: Date | null;
  skills: { id: string; skill: string; yearsExperience: number | null }[];
  experience: {
    id: string;
    title: string;
    organization: string | null;
    description: string | null;
    contact: string | null;
    startDate: Date | null;
    endDate: Date | null;
  }[];
}

/**
 * Strips fields that shouldn't be exposed on the profile endpoint.
 * `linkedinUrl`/`skills`/`experience` are treated as public to any signed-in
 * user, same tier as the rest of a resume's contents. `phone` is only shown
 * to the owner, employers (so they can contact applicants) and admins; other
 * employees get `null`. Each experience entry's `contact` is never exposed.
 */
export async function toPublicUser(user: User, viewer: { id: string; role: User["role"] }) {
  const canSeePhone = viewer.id === user.id || viewer.role === "employer" || viewer.role === "admin";
  const [skills, experience] = await Promise.all([
    db
      .select({ id: userSkills.id, skill: userSkills.skill, yearsExperience: userSkills.yearsExperience })
      .from(userSkills)
      .where(eq(userSkills.userId, user.id)),
    db
      .select({
        id: workExperience.id,
        title: workExperience.title,
        organization: workExperience.organization,
        description: workExperience.description,
        startDate: workExperience.startDate,
        endDate: workExperience.endDate,
      })
      .from(workExperience)
      .where(eq(workExperience.userId, user.id)),
  ]);

  return {
    id: user.id,
    role: user.role,
    isVerified: user.isVerified,
    firstName: user.firstName,
    lastName: user.lastName,
    bio: user.bio,
    phone: canSeePhone ? user.phone : null,
    location: user.location,
    profilePictureUrl: user.profilePictureUrl,
    linkedinUrl: user.linkedinUrl,
    createdAt: user.createdAt,
    skills,
    experience,
  };
}

export async function createUserProfile(input: {
  supertokensUserId: string;
  email: string;
  role?: "employer" | "employee";
}): Promise<User> {
  const [user] = await db
    .insert(users)
    .values({
      supertokensUserId: input.supertokensUserId,
      email: input.email,
      role: input.role ?? "employee",
    })
    .returning();
  if (!user) throw new AppError(500, "Failed to create user profile");
  return user;
}

export async function getUserById(id: string): Promise<User> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  if (!user) throw new AppError(404, "User not found");
  return user;
}

/** Full owner-view profile (includes email, cvUrl, skills, experience contact) for the "my profile" endpoint. */
export async function getMyProfile(userId: string): Promise<OwnUserProfile> {
  const user = await getUserById(userId);
  const [skills, experience] = await Promise.all([
    db
      .select({
        id: userSkills.id,
        skill: userSkills.skill,
        yearsExperience: userSkills.yearsExperience,
      })
      .from(userSkills)
      .where(eq(userSkills.userId, userId)),
    db
      .select({
        id: workExperience.id,
        title: workExperience.title,
        organization: workExperience.organization,
        description: workExperience.description,
        contact: workExperience.contact,
        startDate: workExperience.startDate,
        endDate: workExperience.endDate,
      })
      .from(workExperience)
      .where(eq(workExperience.userId, userId)),
  ]);

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
    bio: user.bio,
    phone: user.phone,
    location: user.location,
    profilePictureUrl: user.profilePictureUrl,
    cvUrl: user.cvUrl,
    linkedinUrl: user.linkedinUrl,
    expoPushToken: user.expoPushToken,
    onboardingCompletedAt: user.onboardingCompletedAt,
    plan: user.plan,
    planExpiresAt: user.planExpiresAt,
    skills,
    experience,
  };
}

export async function completeOnboarding(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ onboardingCompletedAt: new Date() })
    .where(eq(users.id, userId));
}

/**
 * Maps what the user typed to the catalog's canonical (English) name when it matches
 * either language, ignoring case: "camarero", "Camarero" and "waiter" all become
 * "Waiter". Anything not in the catalog is kept as typed. Storing one canonical name
 * is what keeps a skill from splitting into several chips in the employer search.
 */
export async function canonicalSkillName(input: string): Promise<string> {
  const text = input.trim();
  const [hit] = await db
    .select({ name: skillsCatalog.name })
    .from(skillsCatalog)
    .where(or(sql`lower(${skillsCatalog.name}) = lower(${text})`, sql`lower(${skillsCatalog.nameEs}) = lower(${text})`))
    .limit(1);
  return hit?.name ?? text;
}

export async function addSkill(userId: string, input: AddSkillInput) {
  const skill = await canonicalSkillName(input.skill);
  const [row] = await db
    .insert(userSkills)
    .values({ userId, skill, yearsExperience: input.yearsExperience })
    .onConflictDoUpdate({
      target: [userSkills.userId, userSkills.skill],
      // With no years sent there is nothing to change: Drizzle refuses an empty SET, so
      // re-assign the same skill name, which leaves any existing years untouched.
      set: input.yearsExperience === undefined ? { skill } : { yearsExperience: input.yearsExperience },
    })
    .returning();
  if (!row) throw new AppError(500, "Failed to add skill");
  return row;
}

export async function removeSkill(userId: string, skillId: string): Promise<void> {
  await db
    .delete(userSkills)
    .where(and(eq(userSkills.id, skillId), eq(userSkills.userId, userId)));
}

export async function getUserBySupertokensId(stId: string): Promise<User> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.supertokensUserId, stId));
  if (!user) throw new AppError(404, "User not found");
  return user;
}

export async function updateUser(id: string, input: UpdateUserInput): Promise<User> {
  const [user] = await db
    .update(users)
    .set(input)
    .where(eq(users.id, id))
    .returning();
  if (!user) throw new AppError(404, "User not found");
  return user;
}

/**
 * Hard-deletes the caller's own account: the SuperTokens user, then the
 * `users` row (existing cascade FKs on userSkills/workExperience/savedJobs/
 * applications clean up the rest). Employers are blocked while they still
 * own a company — a `company_members` row would otherwise cascade-delete
 * along with them, leaving the company with nobody able to manage it.
 */
export async function deleteOwnAccount(user: User): Promise<void> {
  if (user.role === "employer") {
    const owned = await db
      .select()
      .from(companyMembers)
      .where(and(eq(companyMembers.userId, user.id), eq(companyMembers.role, "owner")));
    if (owned.length > 0) {
      throw new AppError(
        409,
        "Delete or transfer your company profile(s) before deleting your account"
      );
    }
  }

  await supertokens.deleteUser(user.supertokensUserId);
  await db.delete(users).where(eq(users.id, user.id));
}

/** Employer-only worker directory search. `skills` filters via per-skill EXISTS
 * subqueries against `userSkills` (mirrors `searchJobs`'s `tagIds` filter). */
export async function searchWorkers(filters: WorkerSearchQuery): Promise<WorkerSummary[]> {
  // Only people with a name: accounts that signed up but never filled in a profile
  // would show up as empty "?" cards that an employer cannot act on.
  const conditions = [eq(users.role, "employee"), sql`btrim(coalesce(${users.firstName}, '')) <> ''`];

  if (filters.q) {
    const like = `%${filters.q}%`;
    conditions.push(
      // Also matches a skill by its English or Spanish name ("plomero" finds Plumbers).
      sql`(${users.firstName} ILIKE ${like} OR ${users.lastName} ILIKE ${like} OR ${users.bio} ILIKE ${like} OR EXISTS (
        SELECT 1 FROM ${userSkills}
        LEFT JOIN ${skillsCatalog} ON ${skillsCatalog.name} = ${userSkills.skill}
        WHERE ${userSkills.userId} = ${users.id}
        AND (${userSkills.skill} ILIKE ${like} OR ${skillsCatalog.nameEs} ILIKE ${like})
      ))`
    );
  }
  if (filters.location) conditions.push(ilike(users.location, `%${filters.location}%`));
  if (filters.skills && filters.skills.length > 0) {
    for (const skill of filters.skills) {
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM ${userSkills}
          WHERE ${userSkills.userId} = ${users.id}
          AND ${userSkills.skill} = ${skill}
        )`
      );
    }
  }

  const rows = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      bio: users.bio,
      location: users.location,
      profilePictureUrl: users.profilePictureUrl,
    })
    .from(users)
    .where(and(...conditions))
    // Stable order so offset paging never repeats or skips people.
    .orderBy(desc(users.createdAt), users.id)
    .limit(filters.limit ?? 20)
    .offset(filters.offset ?? 0);

  if (rows.length === 0) return [];

  const skillRows = await db
    .select({
      userId: userSkills.userId,
      id: userSkills.id,
      skill: userSkills.skill,
      yearsExperience: userSkills.yearsExperience,
    })
    .from(userSkills)
    .where(
      inArray(
        userSkills.userId,
        rows.map((r) => r.id)
      )
    );

  const skillsByUser = new Map<string, WorkerSummary["skills"]>();
  for (const s of skillRows) {
    const list = skillsByUser.get(s.userId) ?? [];
    list.push({ id: s.id, skill: s.skill, yearsExperience: s.yearsExperience });
    skillsByUser.set(s.userId, list);
  }

  return rows.map((r) => ({ ...r, skills: skillsByUser.get(r.id) ?? [] }));
}

/** Distinct skill strings across all users — powers the Explore Workers filter chips. */
export async function getDistinctSkills(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ skill: userSkills.skill })
    .from(userSkills)
    .orderBy(userSkills.skill)
    .limit(50);
  return rows.map((r) => r.skill);
}

import { randomInt } from "node:crypto";
import { and, asc, count, eq, gt, isNull } from "drizzle-orm";
import { db } from "../../../db/client";
import { companies, companyInvites, companyMembers, users } from "../../../db";
import { AppError } from "../../lib/AppError";
import { getPlanSeatLimit } from "../../lib/plans";
import { insertNotification } from "../notifications/notifications.queries";
import { assertCanManage, assertCompanyOwner, getCompanyById, isCompanyOwner, type RequestingUser } from "../companies/companies.queries";

// No 0/O/1/I/L: codes get read aloud and typed from WhatsApp messages.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const INVITE_TTL_DAYS = 7;

function generateCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

export interface TeamMember {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  profilePictureUrl: string | null;
  role: "owner" | "member";
  joinedAt: Date;
}

export interface TeamInfo {
  members: TeamMember[];
  seatsUsed: number;
  /** null = unlimited */
  seatLimit: number | null;
  planTier: "free" | "basic" | "pro";
  /** Only the owner sees the live code. */
  invite: { code: string; expiresAt: Date } | null;
  /** True for the owner (and platform admins): may invite, remove and see the code. */
  canManage: boolean;
}

async function getLiveInvite(companyId: string) {
  const [invite] = await db
    .select()
    .from(companyInvites)
    .where(
      and(
        eq(companyInvites.companyId, companyId),
        isNull(companyInvites.revokedAt),
        gt(companyInvites.expiresAt, new Date())
      )
    );
  return invite ?? null;
}

export async function getTeam(user: RequestingUser, companyId: string): Promise<TeamInfo> {
  const company = await getCompanyById(companyId);
  await assertCanManage(company, user);
  const owner = await isCompanyOwner(companyId, user);

  const rows = await db
    .select({
      userId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      profilePictureUrl: users.profilePictureUrl,
      role: companyMembers.role,
      joinedAt: companyMembers.createdAt,
    })
    .from(companyMembers)
    .innerJoin(users, eq(users.id, companyMembers.userId))
    .where(eq(companyMembers.companyId, companyId))
    .orderBy(asc(companyMembers.createdAt));

  const invite = owner ? await getLiveInvite(companyId) : null;

  return {
    members: rows.map((r) => ({ ...r, role: r.role === "owner" ? ("owner" as const) : ("member" as const) })),
    seatsUsed: rows.length,
    seatLimit: await getPlanSeatLimit(company.planTier),
    planTier: company.planTier,
    invite: invite ? { code: invite.code, expiresAt: invite.expiresAt } : null,
    canManage: owner,
  };
}

/** Creates a fresh code and revokes any previous live one (one live code per company). */
export async function createInvite(user: RequestingUser, companyId: string) {
  const company = await getCompanyById(companyId);
  await assertCompanyOwner(company, user);

  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);
  return db.transaction(async (tx) => {
    await tx
      .update(companyInvites)
      .set({ revokedAt: new Date() })
      .where(and(eq(companyInvites.companyId, companyId), isNull(companyInvites.revokedAt)));
    const [invite] = await tx
      .insert(companyInvites)
      .values({ companyId, code: generateCode(), createdBy: user.id, expiresAt })
      .returning();
    if (!invite) throw new AppError(500, "Failed to create invite");
    return { code: invite.code, expiresAt: invite.expiresAt };
  });
}

export async function revokeInvite(user: RequestingUser, companyId: string): Promise<void> {
  const company = await getCompanyById(companyId);
  await assertCompanyOwner(company, user);
  await db
    .update(companyInvites)
    .set({ revokedAt: new Date() })
    .where(and(eq(companyInvites.companyId, companyId), isNull(companyInvites.revokedAt)));
}

/**
 * Joins the caller to the company that issued `code`. The company row is locked
 * while seats are counted so two people using the last seat at once can't both get in.
 */
export async function joinByCode(user: { id: string }, code: string) {
  const [invite] = await db
    .select()
    .from(companyInvites)
    .where(
      and(eq(companyInvites.code, code), isNull(companyInvites.revokedAt), gt(companyInvites.expiresAt, new Date()))
    );
  // Same answer for unknown, revoked and expired so codes can't be probed.
  if (!invite) throw new AppError(404, "Invalid or expired code");

  const joined = await db.transaction(async (tx) => {
    const [company] = await tx.select().from(companies).where(eq(companies.id, invite.companyId)).for("update");
    if (!company) throw new AppError(404, "Invalid or expired code");

    const [existing] = await tx
      .select()
      .from(companyMembers)
      .where(and(eq(companyMembers.companyId, company.id), eq(companyMembers.userId, user.id)));
    if (existing) throw new AppError(409, "You are already part of this company");

    const [seats] = await tx
      .select({ n: count() })
      .from(companyMembers)
      .where(eq(companyMembers.companyId, company.id));
    const limit = await getPlanSeatLimit(company.planTier);
    if (limit !== null && (seats?.n ?? 0) >= limit) {
      throw new AppError(403, "This company has reached its team limit", { code: "SEAT_LIMIT_REACHED", limit });
    }

    await tx.insert(companyMembers).values({ companyId: company.id, userId: user.id, role: "admin" });
    return company;
  });

  // Best effort: a failed notification must not undo the join.
  try {
    const [newcomer] = await db
      .select({ firstName: users.firstName, lastName: users.lastName, email: users.email })
      .from(users)
      .where(eq(users.id, user.id));
    const who = [newcomer?.firstName, newcomer?.lastName].filter(Boolean).join(" ") || newcomer?.email || "";
    if (joined.ownerId) {
      await insertNotification({
        userId: joined.ownerId,
        type: "team_member_joined",
        title: "Nuevo miembro · New team member",
        body: `${who} se unió a ${joined.name} · ${who} joined ${joined.name}`,
        data: { companyId: joined.id },
      });
    }
  } catch (err) {
    console.error("Team join notification failed:", err);
  }

  return joined;
}

/** Owner removes a member, or a member leaves (userId === caller). The owner can't be removed. */
export async function removeMember(user: RequestingUser, companyId: string, targetUserId: string): Promise<void> {
  const company = await getCompanyById(companyId);
  const [target] = await db
    .select()
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, targetUserId)));
  if (!target) throw new AppError(404, "Member not found");
  if (target.role === "owner") {
    throw new AppError(409, "The owner can't be removed. Delete the company instead.");
  }
  if (targetUserId !== user.id) await assertCompanyOwner(company, user);
  await db
    .delete(companyMembers)
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, targetUserId)));
}

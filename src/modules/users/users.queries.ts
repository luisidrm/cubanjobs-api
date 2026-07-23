import { eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { users, type User } from "../../../db";
import { AppError } from "../../lib/AppError";
import type { UpdateUserInput } from "./users.schemas";

export function toPublicUser(user: User) {
  return user;
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
  return user;
}

export async function getUserById(id: string): Promise<User> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  if (!user) throw new AppError(404, "User not found");
  return user;
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

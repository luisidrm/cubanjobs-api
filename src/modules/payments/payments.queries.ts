import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../../db/client";
import { payments, planPrices, plans, type Payment } from "../../../db";
import { AppError } from "../../lib/AppError";
import { deletePrivateFile, mimeToExt, uploadPrivateFile } from "../../lib/minio";
import { assertCompanyOwner, getCompanyById, type RequestingUser } from "../companies/companies.queries";
import { normalizeTransferNumber, type SubmitPaymentInput } from "./payments.schemas";
import { logger } from "../../lib/logger";

/** Max payments a user may have waiting for review at once (spam guard). */
export const MAX_PENDING_PER_USER = 3;

interface Payer extends RequestingUser {
  email: string;
}

export interface ScreenshotFile {
  buffer: Buffer;
  mimetype: string;
}

export async function submitPayment(
  user: Payer,
  input: SubmitPaymentInput,
  screenshot?: ScreenshotFile
): Promise<Payment> {
  if (user.role === "admin") throw new AppError(403, "Admins don't buy plans");

  const [plan] = await db.select().from(plans).where(eq(plans.code, input.planCode));
  if (!plan || !plan.isActive) throw new AppError(404, "Plan not found");
  if (plan.audience !== user.role) {
    throw new AppError(403, "That plan is not available for your account type");
  }

  const [price] = await db
    .select()
    .from(planPrices)
    .where(and(eq(planPrices.planId, plan.id), eq(planPrices.months, input.months), eq(planPrices.isActive, true)));
  if (!price) throw new AppError(400, "That duration is not available for this plan");

  let companyId: string | null = null;
  if (plan.audience === "employer") {
    if (!input.companyId) throw new AppError(400, "companyId is required for employer plans");
    const company = await getCompanyById(input.companyId);
    await assertCompanyOwner(company, user);
    companyId = company.id;
  }

  const [pendingRow] = await db
    .select({ pending: sql<number>`count(*)::int` })
    .from(payments)
    .where(and(eq(payments.userId, user.id), eq(payments.status, "pending")));
  if ((pendingRow?.pending ?? 0) >= MAX_PENDING_PER_USER) {
    throw new AppError(429, "You already have payments waiting for review. Please wait for them to be checked.");
  }

  const id = randomUUID();
  const normalized = normalizeTransferNumber(input.transferNumber);
  if (normalized.length < 4) throw new AppError(400, "The transfer number is required");

  let created: Payment;
  try {
    [created] = await db
      .insert(payments)
      .values({
        id,
        userId: user.id,
        payerEmail: user.email,
        companyId,
        planId: plan.id,
        months: input.months,
        amountCup: price.priceCup,
        transferNumber: input.transferNumber.trim(),
        transferNumberNormalized: normalized,
      })
      .returning() as [Payment];
  } catch (err) {
    // Drizzle wraps the driver error: the Postgres code is on err.cause.
    const pgCode = (err as { code?: string; cause?: { code?: string } }).code ?? (err as { cause?: { code?: string } }).cause?.code;
    if (pgCode === "23505") {
      throw new AppError(409, "This transfer number was already submitted");
    }
    throw err;
  }

  if (screenshot) {
    const key = `payments/${id}/screenshot.${mimeToExt(screenshot.mimetype)}`;
    try {
      await uploadPrivateFile(screenshot.buffer, key, screenshot.mimetype);
      [created] = (await db
        .update(payments)
        .set({ screenshotKey: key })
        .where(eq(payments.id, id))
        .returning()) as [Payment];
    } catch (err) {
      logger.error("Payment screenshot upload failed:", err);
      // The screenshot is optional, but a half-saved payment is worse than a
      // retry: undo the row (and any partial upload) so the user can resubmit.
      await db.delete(payments).where(eq(payments.id, id));
      await deletePrivateFile(key).catch(() => null);
      throw new AppError(502, "We couldn't save your screenshot. Please try again.");
    }
  }

  return created;
}

export interface MyPayment {
  id: string;
  planCode: string;
  planName: string;
  months: number;
  amountCup: number;
  transferNumber: string;
  status: Payment["status"];
  rejectReason: string | null;
  hasScreenshot: boolean;
  createdAt: Date;
}

export async function getMyPayments(userId: string): Promise<MyPayment[]> {
  const rows = await db
    .select({
      id: payments.id,
      planCode: plans.code,
      planName: plans.name,
      months: payments.months,
      amountCup: payments.amountCup,
      transferNumber: payments.transferNumber,
      status: payments.status,
      rejectReason: payments.rejectReason,
      screenshotKey: payments.screenshotKey,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .innerJoin(plans, eq(plans.id, payments.planId))
    .where(eq(payments.userId, userId))
    .orderBy(desc(payments.createdAt))
    .limit(50);

  return rows.map(({ screenshotKey, ...r }) => ({ ...r, hasScreenshot: !!screenshotKey }));
}

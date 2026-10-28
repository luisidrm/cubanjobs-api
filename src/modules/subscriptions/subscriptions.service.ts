import { eq } from "drizzle-orm";
import { db } from "../../../db/client";
import {
  companies,
  payments,
  planEvents,
  plans,
  users,
  type CompanyPlan,
  type Payment,
} from "../../../db";
import { AppError } from "../../lib/AppError";
import { buildPlanEmailHtml, escapeHtml } from "../../lib/emailTemplate";
import { buildAppLink } from "../../lib/email";
import { enqueuePlanNotification } from "../../lib/queue";
import { insertNotification } from "../notifications/notifications.queries";

// ---------------------------------------------------------------------------
// Date rules
// ---------------------------------------------------------------------------

/** Calendar-month addition that clamps the day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/**
 * New plan end date after a payment. If the plan is still running the months
 * stack on the current expiry (renewing early loses nothing); otherwise they
 * start from `now`.
 */
export function computeNewExpiry(current: Date | null, months: number, now = new Date()): Date {
  const base = current && current > now ? current : now;
  return addMonths(base, months);
}

/** A plan with no expiry date never lapses (set manually by an admin). */
export function isPlanActive(expiresAt: Date | null, now = new Date()): boolean {
  return expiresAt === null || expiresAt > now;
}

// ---------------------------------------------------------------------------
// Employee entitlement
// ---------------------------------------------------------------------------

/** True when the employee currently has the paid plan (applying requires it). */
export async function hasActiveEmployeePlan(userId: string, now = new Date()): Promise<boolean> {
  const [user] = await db
    .select({ plan: users.plan, planExpiresAt: users.planExpiresAt })
    .from(users)
    .where(eq(users.id, userId));
  return !!user && user.plan === "paid" && isPlanActive(user.planExpiresAt, now);
}

/** Push + email for a payment outcome (the in-app notification is inserted separately). Best effort. */
async function sendOutcomeMessage(
  userId: string,
  email: string,
  title: string,
  body: string,
  sections: [{ heading: string; body: string }, { heading: string; body: string }]
): Promise<void> {
  const [u] = await db.select({ expoPushToken: users.expoPushToken }).from(users).where(eq(users.id, userId));
  await enqueuePlanNotification({
    email,
    subject: title,
    html: buildPlanEmailHtml(sections, "Abrir Brújula · Open Brújula", buildAppLink("/billing", {})),
    expoPushToken: u?.expoPushToken ?? null,
    pushTitle: title,
    pushBody: body,
  });
}

// ---------------------------------------------------------------------------
// Approve / reject a Transfermóvil payment
// ---------------------------------------------------------------------------

export interface ApprovalResult {
  payment: Payment;
  planCode: string;
  expiresAt: Date | null;
}

export async function approvePayment(paymentId: string, adminId: string): Promise<ApprovalResult> {
  const result = await db.transaction(async (tx) => {
    // Lock the row so two admins approving at once can't both extend the plan.
    const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("update");
    if (!payment) throw new AppError(404, "Payment not found");
    if (payment.status !== "pending") {
      throw new AppError(409, `This payment was already ${payment.status}`);
    }

    const [plan] = await tx.select().from(plans).where(eq(plans.id, payment.planId));
    if (!plan) throw new AppError(404, "Plan not found");

    const now = new Date();
    let expiresAt: Date | null;
    let fromPlan: string;

    if (plan.audience === "employee") {
      if (!payment.userId) throw new AppError(409, "The paying account no longer exists");
      const [user] = await tx.select().from(users).where(eq(users.id, payment.userId)).for("update");
      if (!user) throw new AppError(409, "The paying account no longer exists");

      fromPlan = user.plan === "paid" ? "employee_paid" : "free";
      const currentlyPaid = user.plan === "paid" && isPlanActive(user.planExpiresAt, now);
      // A paid plan with no expiry stays open-ended; otherwise stack the months.
      expiresAt =
        currentlyPaid && user.planExpiresAt === null
          ? null
          : computeNewExpiry(currentlyPaid ? user.planExpiresAt : null, payment.months, now);

      await tx
        .update(users)
        .set({ plan: "paid", planExpiresAt: expiresAt, planSource: "transfermovil", planReminderSentAt: null })
        .where(eq(users.id, user.id));

      await tx.insert(planEvents).values({
        userId: user.id,
        fromPlan,
        toPlan: "employee_paid",
        expiresAt,
        reason: "payment_approved",
        paymentId: payment.id,
        actorId: adminId,
      });
    } else {
      if (!payment.companyId) throw new AppError(409, "This payment is missing its company");
      const [company] = await tx
        .select()
        .from(companies)
        .where(eq(companies.id, payment.companyId))
        .for("update");
      if (!company) throw new AppError(409, "The company no longer exists");

      if (company.planSource === "stripe" && company.planTier !== "free") {
        throw new AppError(
          409,
          "This company has an active card subscription (Stripe). Cancel it first or set the plan manually."
        );
      }

      fromPlan = company.planTier;
      const sameTierActive =
        company.planTier === plan.code &&
        company.planTier !== "free" &&
        isPlanActive(company.planExpiresAt, now);
      // Open-ended same-tier plan stays open-ended; a different tier starts fresh from now.
      expiresAt =
        sameTierActive && company.planExpiresAt === null
          ? null
          : computeNewExpiry(sameTierActive ? company.planExpiresAt : null, payment.months, now);

      await tx
        .update(companies)
        .set({
          planTier: plan.code as CompanyPlan,
          planExpiresAt: expiresAt,
          planSource: "transfermovil",
          planReminderSentAt: null,
        })
        .where(eq(companies.id, company.id));

      await tx.insert(planEvents).values({
        companyId: company.id,
        fromPlan,
        toPlan: plan.code,
        expiresAt,
        reason: "payment_approved",
        paymentId: payment.id,
        actorId: adminId,
      });
    }

    const [updated] = await tx
      .update(payments)
      .set({ status: "approved", reviewedBy: adminId, reviewedAt: now, rejectReason: null })
      .where(eq(payments.id, payment.id))
      .returning();

    return { payment: updated!, planCode: plan.code, expiresAt };
  });

  if (result.payment.userId) {
    await insertNotification({
      userId: result.payment.userId,
      type: "payment_approved",
      title: "Pago aprobado · Payment approved",
      body: result.expiresAt
        ? `Tu plan está activo hasta el ${result.expiresAt.toISOString().slice(0, 10)}. · Your plan is active until ${result.expiresAt.toISOString().slice(0, 10)}.`
        : "Tu plan está activo. · Your plan is active.",
      data: { paymentId: result.payment.id },
    }).catch((err) => console.warn("⚠️  payment_approved notification failed:", (err as Error).message));
    const until = result.expiresAt ? result.expiresAt.toISOString().slice(0, 10) : null;
    await sendOutcomeMessage(
      result.payment.userId,
      result.payment.payerEmail,
      "Pago aprobado · Payment approved",
      until ? `Tu plan está activo hasta el ${until}. · Your plan is active until ${until}.` : "Tu plan está activo. · Your plan is active.",
      [
        { heading: "Pago aprobado", body: until ? `Verificamos tu transferencia. Tu plan está activo hasta el <strong>${until}</strong>.` : "Verificamos tu transferencia. Tu plan está activo." },
        { heading: "Payment approved", body: until ? `We verified your transfer. Your plan is active until <strong>${until}</strong>.` : "We verified your transfer. Your plan is active." },
      ]
    ).catch((err) => console.warn("⚠️  payment_approved message failed:", (err as Error).message));
  }

  return result;
}

export async function rejectPayment(paymentId: string, adminId: string, reason: string): Promise<Payment> {
  const rejected = await db.transaction(async (tx) => {
    const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("update");
    if (!payment) throw new AppError(404, "Payment not found");
    if (payment.status !== "pending") {
      throw new AppError(409, `This payment was already ${payment.status}`);
    }
    const [updated] = await tx
      .update(payments)
      .set({ status: "rejected", reviewedBy: adminId, reviewedAt: new Date(), rejectReason: reason })
      .where(eq(payments.id, payment.id))
      .returning();
    return updated!;
  });

  if (rejected.userId) {
    await insertNotification({
      userId: rejected.userId,
      type: "payment_rejected",
      title: "Pago rechazado · Payment rejected",
      body: `${reason} Puedes enviar el pago de nuevo. · You can submit the payment again.`,
      data: { paymentId: rejected.id },
    }).catch((err) => console.warn("⚠️  payment_rejected notification failed:", (err as Error).message));
    await sendOutcomeMessage(
      rejected.userId,
      rejected.payerEmail,
      "Pago rechazado · Payment rejected",
      `${reason} Puedes enviar el pago de nuevo. · You can submit the payment again.`,
      [
        { heading: "Pago rechazado", body: `No pudimos confirmar tu transferencia: ${escapeHtml(reason)} Puedes enviar el pago de nuevo desde la app.` },
        { heading: "Payment rejected", body: `We couldn't confirm your transfer: ${escapeHtml(reason)} You can submit the payment again from the app.` },
      ]
    ).catch((err) => console.warn("⚠️  payment_rejected message failed:", (err as Error).message));
  }

  return rejected;
}

// ---------------------------------------------------------------------------
// Manual plan changes (admin)
// ---------------------------------------------------------------------------

export type ManualPlanTarget =
  | { userId: string; plan: "free" | "paid" }
  | { companyId: string; plan: CompanyPlan };

/**
 * Sets an account's plan by hand. `expiresAt: null` on a paid plan means no
 * expiry. Switching to free clears the expiry. Always logged to plan_events.
 */
export async function setPlanManually(
  target: ManualPlanTarget,
  expiresAt: Date | null,
  actorId: string,
  note?: string
): Promise<void> {
  await db.transaction(async (tx) => {
    if ("userId" in target) {
      const [user] = await tx.select().from(users).where(eq(users.id, target.userId)).for("update");
      if (!user) throw new AppError(404, "User not found");
      if (user.role !== "employee") throw new AppError(400, "Only employee accounts have an employee plan");

      const paid = target.plan === "paid";
      await tx
        .update(users)
        .set({
          plan: target.plan,
          planExpiresAt: paid ? expiresAt : null,
          planSource: paid ? "manual" : "none",
          planReminderSentAt: null,
        })
        .where(eq(users.id, user.id));

      await tx.insert(planEvents).values({
        userId: user.id,
        fromPlan: user.plan === "paid" ? "employee_paid" : "free",
        toPlan: paid ? "employee_paid" : "free",
        expiresAt: paid ? expiresAt : null,
        reason: "manual",
        actorId,
        note,
      });
    } else {
      const [company] = await tx
        .select()
        .from(companies)
        .where(eq(companies.id, target.companyId))
        .for("update");
      if (!company) throw new AppError(404, "Company not found");

      const paid = target.plan !== "free";
      await tx
        .update(companies)
        .set({
          planTier: target.plan,
          planExpiresAt: paid ? expiresAt : null,
          planSource: paid ? "manual" : "none",
          planReminderSentAt: null,
        })
        .where(eq(companies.id, company.id));

      await tx.insert(planEvents).values({
        companyId: company.id,
        fromPlan: company.planTier,
        toPlan: target.plan,
        expiresAt: paid ? expiresAt : null,
        reason: "manual",
        actorId,
        note,
      });
    }
  });
}

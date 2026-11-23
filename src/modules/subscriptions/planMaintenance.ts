import { and, eq, gt, inArray, isNotNull, isNull, lte, ne } from "drizzle-orm";
import { db } from "../../../db/client";
import { companies, companyMembers, planEvents, plans, users, type Company, type User } from "../../../db";
import { buildPlanEmailHtml, escapeHtml } from "../../lib/emailTemplate";
import { buildAppLink } from "../../lib/email";
import { enqueuePlanNotification } from "../../lib/queue";
import { insertNotification } from "../notifications/notifications.queries";
import { getSettings } from "../plans/plans.queries";
import { logger } from "../../lib/logger";

// Plans paid through Transfermóvil (or set by hand) end by themselves.
// Stripe-managed plans are renewed or cancelled by Stripe's webhooks instead.
const SELF_EXPIRING_SOURCES = ["transfermovil", "manual"] as const;

const DEFAULT_REMINDER_DAYS = 3;

export interface MaintenanceReport {
  reminded: number;
  downgraded: number;
}

interface Recipient {
  userId: string;
  email: string;
  expoPushToken: string | null;
}

type NoticeKind = "expiring" | "expired";

interface Notice {
  kind: NoticeKind;
  /** Display name of the plan that is ending ("Pro", "Employee"). */
  planName: string;
  /** Company name for employer plans, so the message says which one. */
  companyName?: string;
  expiresAt: Date;
}

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

/** Bilingual (Spanish first) copy for the in-app notification, push and email. */
export function buildNoticeCopy(n: Notice) {
  const forWhat = n.companyName ? ` (${n.companyName})` : "";
  // The same text goes into email HTML, where a company name must not be able to inject markup.
  const forWhatHtml = n.companyName ? ` (${escapeHtml(n.companyName)})` : "";
  const date = fmtDate(n.expiresAt);

  if (n.kind === "expiring") {
    return {
      title: "Tu plan vence pronto · Your plan expires soon",
      body: `Tu plan ${n.planName}${forWhat} vence el ${date}. Renuévalo para no perderlo. · Your ${n.planName} plan${forWhat} expires on ${date}. Renew it to keep it.`,
      subject: "Tu plan vence pronto · Your plan expires soon",
      sections: [
        {
          heading: "Tu plan vence pronto",
          body: `Tu plan <strong>${n.planName}</strong>${forWhatHtml} vence el <strong>${date}</strong>. Renuévalo desde la app para no perder tus beneficios.`,
        },
        {
          heading: "Your plan expires soon",
          body: `Your <strong>${n.planName}</strong> plan${forWhatHtml} expires on <strong>${date}</strong>. Renew it from the app to keep your benefits.`,
        },
      ] as [{ heading: string; body: string }, { heading: string; body: string }],
      cta: "Renovar · Renew",
    };
  }

  return {
    title: "Tu plan terminó · Your plan has ended",
    body: `Tu plan ${n.planName}${forWhat} terminó y ahora estás en el plan Gratis. Renueva para recuperar tus beneficios. · Your ${n.planName} plan${forWhat} has ended and you're now on the Free plan. Renew to get your benefits back.`,
    subject: "Tu plan terminó · Your plan has ended",
    sections: [
      {
        heading: "Tu plan terminó",
        body: `Tu plan <strong>${n.planName}</strong>${forWhatHtml} terminó el ${date} y ahora estás en el plan Gratis. Renueva para recuperar tus beneficios.`,
      },
      {
        heading: "Your plan has ended",
        body: `Your <strong>${n.planName}</strong> plan${forWhatHtml} ended on ${date} and you're now on the Free plan. Renew to get your benefits back.`,
      },
    ] as [{ heading: string; body: string }, { heading: string; body: string }],
    cta: "Renovar · Renew",
  };
}

/** In-app notification + push + email for one person. Never throws: a failed message must not undo the plan change. */
async function notifyRecipient(r: Recipient, n: Notice): Promise<void> {
  const copy = buildNoticeCopy(n);
  try {
    await insertNotification({
      userId: r.userId,
      type: n.kind === "expiring" ? "plan_expiring" : "plan_expired",
      title: copy.title,
      body: copy.body,
      data: { planName: n.planName, expiresAt: n.expiresAt.toISOString() },
    });
  } catch (err) {
    logger.warn("⚠️  Plan notification insert failed:", (err as Error).message);
  }

  await enqueuePlanNotification({
    email: r.email,
    subject: copy.subject,
    html: buildPlanEmailHtml(copy.sections, copy.cta, buildAppLink("/billing", {})),
    expoPushToken: r.expoPushToken,
    pushTitle: copy.title,
    pushBody: copy.body,
  });
}

async function planNames(): Promise<Record<string, string>> {
  const rows = await db.select({ code: plans.code, name: plans.name }).from(plans);
  return Object.fromEntries(rows.map((r) => [r.code, r.name]));
}

/** Owners and admins of a company: the people who can renew its plan. */
async function companyRecipients(companyId: string): Promise<Recipient[]> {
  const rows = await db
    .select({ userId: users.id, email: users.email, expoPushToken: users.expoPushToken })
    .from(companyMembers)
    .innerJoin(users, eq(users.id, companyMembers.userId))
    .where(eq(companyMembers.companyId, companyId));
  return rows;
}

function userRecipient(u: Pick<User, "id" | "email" | "expoPushToken">): Recipient {
  return { userId: u.id, email: u.email, expoPushToken: u.expoPushToken };
}

async function reminderDays(): Promise<number> {
  const s = await getSettings(["reminder_days_before"]);
  const n = Number(s.reminder_days_before);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_REMINDER_DAYS;
}

/**
 * Warns accounts whose paid plan ends within the reminder window (default 3
 * days). Each period is warned once: the row is claimed with an UPDATE that
 * only succeeds while no reminder was sent, so a re-run or a second instance
 * can't send it twice. Approving a renewal clears the flag for the next period.
 */
export async function sendExpiryReminders(now = new Date()): Promise<number> {
  const days = await reminderDays();
  const windowEnd = new Date(now.getTime() + days * 86_400_000);
  const names = await planNames();
  let sent = 0;

  const dueUsers = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.plan, "paid"),
        inArray(users.planSource, [...SELF_EXPIRING_SOURCES]),
        isNotNull(users.planExpiresAt),
        gt(users.planExpiresAt, now),
        lte(users.planExpiresAt, windowEnd),
        isNull(users.planReminderSentAt)
      )
    );

  for (const u of dueUsers) {
    const [claimed] = await db
      .update(users)
      .set({ planReminderSentAt: now })
      .where(and(eq(users.id, u.id), isNull(users.planReminderSentAt)))
      .returning({ id: users.id });
    if (!claimed) continue;
    await notifyRecipient(userRecipient(u), {
      kind: "expiring",
      planName: names.employee_paid ?? "Employee",
      expiresAt: u.planExpiresAt!,
    });
    sent++;
  }

  const dueCompanies = await db
    .select()
    .from(companies)
    .where(
      and(
        ne(companies.planTier, "free"),
        inArray(companies.planSource, [...SELF_EXPIRING_SOURCES]),
        isNotNull(companies.planExpiresAt),
        gt(companies.planExpiresAt, now),
        lte(companies.planExpiresAt, windowEnd),
        isNull(companies.planReminderSentAt)
      )
    );

  for (const c of dueCompanies) {
    const [claimed] = await db
      .update(companies)
      .set({ planReminderSentAt: now })
      .where(and(eq(companies.id, c.id), isNull(companies.planReminderSentAt)))
      .returning({ id: companies.id });
    if (!claimed) continue;
    for (const r of await companyRecipients(c.id)) {
      await notifyRecipient(r, {
        kind: "expiring",
        planName: names[c.planTier] ?? c.planTier,
        companyName: c.name,
        expiresAt: c.planExpiresAt!,
      });
    }
    sent++;
  }

  return sent;
}

/**
 * Moves accounts whose paid plan has lapsed to Free (no grace period) and
 * tells them. Employers keep their existing jobs; the lower limit only blocks
 * posting new ones. Applications already sent stay valid.
 */
export async function downgradeExpiredPlans(now = new Date()): Promise<number> {
  const names = await planNames();
  let downgraded = 0;

  const expiredUsers = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.plan, "paid"),
        inArray(users.planSource, [...SELF_EXPIRING_SOURCES]),
        isNotNull(users.planExpiresAt),
        lte(users.planExpiresAt, now)
      )
    );

  for (const u of expiredUsers) {
    const [claimed] = await db
      .update(users)
      .set({ plan: "free", planSource: "none", planExpiresAt: null, planReminderSentAt: null })
      .where(and(eq(users.id, u.id), eq(users.plan, "paid"), lte(users.planExpiresAt, now)))
      .returning({ id: users.id });
    if (!claimed) continue;
    await db.insert(planEvents).values({
      userId: u.id,
      fromPlan: "employee_paid",
      toPlan: "free",
      expiresAt: u.planExpiresAt,
      reason: "expired",
    });
    await notifyRecipient(userRecipient(u), {
      kind: "expired",
      planName: names.employee_paid ?? "Employee",
      expiresAt: u.planExpiresAt!,
    });
    downgraded++;
  }

  const expiredCompanies: Company[] = await db
    .select()
    .from(companies)
    .where(
      and(
        ne(companies.planTier, "free"),
        inArray(companies.planSource, [...SELF_EXPIRING_SOURCES]),
        isNotNull(companies.planExpiresAt),
        lte(companies.planExpiresAt, now)
      )
    );

  for (const c of expiredCompanies) {
    const [claimed] = await db
      .update(companies)
      .set({ planTier: "free", planSource: "none", planExpiresAt: null, planReminderSentAt: null })
      .where(and(eq(companies.id, c.id), eq(companies.planTier, c.planTier), lte(companies.planExpiresAt, now)))
      .returning({ id: companies.id });
    if (!claimed) continue;
    await db.insert(planEvents).values({
      companyId: c.id,
      fromPlan: c.planTier,
      toPlan: "free",
      expiresAt: c.planExpiresAt,
      reason: "expired",
    });
    for (const r of await companyRecipients(c.id)) {
      await notifyRecipient(r, {
        kind: "expired",
        planName: names[c.planTier] ?? c.planTier,
        companyName: c.name,
        expiresAt: c.planExpiresAt!,
      });
    }
    downgraded++;
  }

  return downgraded;
}

/** The daily job: downgrade first (so an expired plan isn't also "warned"), then warn. */
export async function runPlanMaintenance(now = new Date()): Promise<MaintenanceReport> {
  const downgraded = await downgradeExpiredPlans(now);
  const reminded = await sendExpiryReminders(now);
  logger.info(`🗓️  Plan maintenance: ${reminded} reminded, ${downgraded} downgraded`);
  return { reminded, downgraded };
}


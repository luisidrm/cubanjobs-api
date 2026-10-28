import { Queue, Worker, type Job } from "bullmq";
import Redis from "ioredis";
import { sendEmail } from "./email";
import { sendPushNotification } from "./push";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

// ioredis wraps failed connection attempts in an AggregateError whose message is
// empty; fall back to the code (e.g. ECONNREFUSED) so the log says something.
function describeError(err: Error & { code?: string }): string {
  return err.message || err.code || err.constructor.name;
}

// BullMQ requires this on any connection used by a Worker (blocking commands).
// Separate connections for the producer (queue) and consumer (worker) rather
// than sharing one, per BullMQ's own recommendation.
function createConnection() {
  const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  // Redis being down must not crash the process — job enqueue/processing
  // just silently no-ops/retries instead of the whole API going down with it.
  connection.on("error", (err) => {
    console.warn("⚠️  Redis connection error (notifications degraded):", describeError(err));
  });
  return connection;
}

export interface ApplicationStatusChangedJob {
  applicantEmail: string;
  applicantName: string;
  expoPushToken: string | null;
  jobTitle: string;
  companyName: string;
  status: string;
}

/** Expiry reminder / downgrade message: already rendered, just deliver it. */
export interface PlanNotificationJob {
  email: string;
  subject: string;
  html: string;
  expoPushToken: string | null;
  pushTitle: string;
  pushBody: string;
}

type NotificationJob = ApplicationStatusChangedJob | PlanNotificationJob;

const QUEUE_NAME = "notifications";

const notificationQueue = new Queue<NotificationJob>(QUEUE_NAME, {
  connection: createConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
  },
});

/** Enqueues a notification job. Failures here (e.g. Redis unreachable) are
 * logged, not thrown — a notification failing to send must never fail the
 * application-status-update request that triggered it. */
export async function enqueueApplicationStatusNotification(
  data: ApplicationStatusChangedJob
): Promise<void> {
  try {
    await notificationQueue.add("application-status-changed", data);
  } catch (err) {
    console.warn("⚠️  Failed to enqueue notification job:", (err as Error).message);
  }
}

/** Enqueues a plan reminder / downgrade message. Like the application one, a
 * failure to enqueue is logged, never thrown: the in-app notification and the
 * plan change itself must not depend on Redis being up. */
export async function enqueuePlanNotification(data: PlanNotificationJob): Promise<void> {
  try {
    await notificationQueue.add("plan-notification", data);
  } catch (err) {
    console.warn("⚠️  Failed to enqueue plan notification:", (err as Error).message);
  }
}

const worker = new Worker<NotificationJob>(
  QUEUE_NAME,
  async (job: Job<NotificationJob>) => {
    if (job.name === "plan-notification") {
      const plan = job.data as PlanNotificationJob;
      if (plan.expoPushToken) {
        try {
          await sendPushNotification(plan.expoPushToken, plan.pushTitle, plan.pushBody);
        } catch (err) {
          console.warn("⚠️  Push notification failed:", (err as Error).message);
        }
      }
      await sendEmail({ to: plan.email, subject: plan.subject, html: plan.html });
      return;
    }

    const { applicantEmail, applicantName, expoPushToken, jobTitle, companyName, status } =
      job.data as ApplicationStatusChangedJob;

    const subject = `Your application to ${jobTitle} was updated`;
    const html = `<p>Hi ${applicantName},</p><p>Your application to <strong>${jobTitle}</strong> at <strong>${companyName}</strong> is now <strong>${status}</strong>.</p>`;

    // Push is a best-effort bonus channel — its failure shouldn't retry the
    // whole job (and re-send the email). Email is the primary channel, so
    // its rejection is left to propagate and trigger BullMQ's retry/backoff.
    if (expoPushToken) {
      try {
        await sendPushNotification(expoPushToken, subject, `Status: ${status}`);
      } catch (err) {
        console.warn("⚠️  Push notification failed:", (err as Error).message);
      }
    }

    await sendEmail({ to: applicantEmail, subject, html });
  },
  { connection: createConnection() }
);

worker.on("error", (err) => {
  console.warn("⚠️  Notification worker error:", describeError(err));
});

// ---------------------------------------------------------------------------
// Daily plan maintenance (expiry reminders + automatic downgrade)
// ---------------------------------------------------------------------------

const MAINTENANCE_QUEUE = "plan-maintenance";
let maintenanceQueue: Queue | null = null;
let maintenanceWorker: Worker | null = null;

/**
 * Registers the once-a-day plan job (09:00 Havana time) and the worker that
 * runs it. The handler is injected by index.ts so this file doesn't import the
 * subscription code that itself enqueues notifications (no import cycle).
 * Idempotent: restarting the API just updates the same schedule.
 */
export async function startPlanMaintenance(run: () => Promise<void>): Promise<void> {
  try {
    maintenanceQueue = new Queue(MAINTENANCE_QUEUE, { connection: createConnection() });
    await maintenanceQueue.upsertJobScheduler(
      "daily-plan-maintenance",
      { pattern: "0 9 * * *", tz: "America/Havana" },
      { name: "run", opts: { attempts: 3, backoff: { type: "exponential", delay: 60_000 } } }
    );
    maintenanceWorker = new Worker(MAINTENANCE_QUEUE, async () => run(), { connection: createConnection() });
    maintenanceWorker.on("error", (err) => {
      console.warn("⚠️  Plan maintenance worker error:", describeError(err));
    });
  } catch (err) {
    console.warn("⚠️  Could not schedule plan maintenance:", (err as Error).message);
  }
}

/** Call during graceful shutdown (SIGTERM/SIGINT) so the worker finishes its
 * current job and both Redis connections close cleanly instead of being dropped. */
export async function closeNotificationQueue(): Promise<void> {
  await worker.close();
  await notificationQueue.close();
  await maintenanceWorker?.close();
  await maintenanceQueue?.close();
}

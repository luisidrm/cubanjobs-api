import { Queue, Worker, type Job } from "bullmq";
import Redis from "ioredis";
import { sendEmail } from "./email";
import { sendPushNotification } from "./push";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

// BullMQ requires this on any connection used by a Worker (blocking commands).
// Separate connections for the producer (queue) and consumer (worker) rather
// than sharing one, per BullMQ's own recommendation.
function createConnection() {
  const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  // Redis being down must not crash the process — job enqueue/processing
  // just silently no-ops/retries instead of the whole API going down with it.
  connection.on("error", (err) => {
    console.warn("⚠️  Redis connection error (notifications degraded):", err.message);
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

const QUEUE_NAME = "notifications";

const notificationQueue = new Queue<ApplicationStatusChangedJob>(QUEUE_NAME, {
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

const worker = new Worker<ApplicationStatusChangedJob>(
  QUEUE_NAME,
  async (job: Job<ApplicationStatusChangedJob>) => {
    const { applicantEmail, applicantName, expoPushToken, jobTitle, companyName, status } =
      job.data;

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
  console.warn("⚠️  Notification worker error:", err.message);
});

/** Call during graceful shutdown (SIGTERM/SIGINT) so the worker finishes its
 * current job and both Redis connections close cleanly instead of being dropped. */
export async function closeNotificationQueue(): Promise<void> {
  await worker.close();
  await notificationQueue.close();
}

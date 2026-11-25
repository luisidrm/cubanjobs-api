import "dotenv/config";

import app from "./app";
import { checkDatabaseConnection, closeDatabaseConnection } from "../db/client";
import { checkEnv } from "./lib/checkEnv";
import { ensureBucket, ensureBuckets } from "./lib/minio";
// Starting the BullMQ notification queue/worker is a side effect of this
// import. Its own Redis connections handle unreachable-Redis non-fatally
// internally (see lib/queue.ts) — nothing to await or catch here.
import { closeNotificationQueue, startPlanMaintenance } from "./lib/queue";
import { runPlanMaintenance } from "./modules/subscriptions/planMaintenance";
import { logger } from "./lib/logger";
import { flushSentry, initSentry } from "./lib/sentry";

const PORT = Number(process.env.PORT) || 3000;

async function start() {
  if (initSentry()) logger.info("✅ Error reporting (Sentry) enabled");

  try {
    checkEnv();
  } catch (err) {
    logger.error("❌", (err as Error).message);
    await flushSentry();
    process.exit(1);
  }

  try {
    await checkDatabaseConnection();
    logger.info("✅ Database connection verified");
  } catch (err) {
    logger.error("❌ Failed to connect to the database:", err);
    await flushSentry();
    process.exit(1);
  }

  try {
    await ensureBuckets();
    logger.info("✅ MinIO bucket ready");
  } catch (err) {
    logger.warn("⚠️  MinIO not available:", (err as Error).message);
    // Non-fatal on startup — uploads will fail at request time if MinIO is down
  }

  // Daily at 09:00 Havana: warn accounts about to expire, downgrade lapsed ones.
  void startPlanMaintenance(async () => {
    await runPlanMaintenance();
  });

  const server = app.listen(PORT, async (error?: Error) => {
    // Express 5 hands listen failures (port already taken) to this callback; without
    // this check the process claimed to be running while another one served the port.
    if (error) {
      logger.error(`Could not listen on port ${PORT}`, error);
      await flushSentry();
      process.exit(1);
    }
    logger.info(`🚀 Server running on http://localhost:${PORT}`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`\n${signal} received, shutting down gracefully...`);
    server.close(async () => {
      await closeDatabaseConnection();
      await closeNotificationQueue();
      await flushSentry();
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // A forgotten await or an unhandled rejection must show up in the logs (and Sentry), not vanish.
  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection", reason instanceof Error ? reason : new Error(String(reason)));
  });
}

start();

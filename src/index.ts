import "dotenv/config";

import app from "./app";
import { checkDatabaseConnection, closeDatabaseConnection } from "../db/client";
import { ensureBucket, ensureBuckets } from "./lib/minio";
// Starting the BullMQ notification queue/worker is a side effect of this
// import. Its own Redis connections handle unreachable-Redis non-fatally
// internally (see lib/queue.ts) — nothing to await or catch here.
import { closeNotificationQueue, startPlanMaintenance } from "./lib/queue";
import { runPlanMaintenance } from "./modules/subscriptions/planMaintenance";

const PORT = Number(process.env.PORT) || 3000;

async function start() {
  try {
    await checkDatabaseConnection();
    console.log("✅ Database connection verified");
  } catch (err) {
    console.error("❌ Failed to connect to the database:", err);
    process.exit(1);
  }

  try {
    await ensureBuckets();
    console.log("✅ MinIO bucket ready");
  } catch (err) {
    console.warn("⚠️  MinIO not available:", (err as Error).message);
    // Non-fatal on startup — uploads will fail at request time if MinIO is down
  }

  // Daily at 09:00 Havana: warn accounts about to expire, downgrade lapsed ones.
  void startPlanMaintenance(async () => {
    await runPlanMaintenance();
  });

  const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received, shutting down gracefully...`);
    server.close(async () => {
      await closeDatabaseConnection();
      await closeNotificationQueue();
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start();

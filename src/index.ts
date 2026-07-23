import "dotenv/config";

import app from "./app";
import { checkDatabaseConnection, closeDatabaseConnection } from "../db/client";
import { ensureBucket } from "./lib/minio";

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
    await ensureBucket();
    console.log("✅ MinIO bucket ready");
  } catch (err) {
    console.warn("⚠️  MinIO not available:", (err as Error).message);
    // Non-fatal on startup — uploads will fail at request time if MinIO is down
  }

  const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received, shutting down gracefully...`);
    server.close(async () => {
      await closeDatabaseConnection();
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start();

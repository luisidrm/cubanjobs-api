import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    // pool: "forks" gives each test FILE its own process, so files can't
    // accidentally share the module-level db/stripe/minio singletons —
    // each test file should still generate its own unique fixture data
    // (random emails/company names) rather than relying on shared seed rows.
    pool: "forks",
    // Test files share one database, and the admin metrics test measures global
    // counts before/after its own fixtures. Running files one at a time keeps
    // other files' users and payments from landing inside that window.
    fileParallelism: false,
  },
});

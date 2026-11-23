/**
 * Fails fast at boot when production is missing configuration, instead of
 * surfacing as a 500 on the first request that needs it (an upload, a
 * password-reset email, a session check).
 */
const REQUIRED_IN_PRODUCTION = [
  "DATABASE_URL",
  "SUPERTOKENS_URL",
  "API_DOMAIN",
  "WEBSITE_DOMAIN",
  "MINIO_ENDPOINT",
  "MINIO_ACCESS_KEY",
  "MINIO_SECRET_KEY",
  "MINIO_PUBLIC_URL",
  "REDIS_URL",
  "RESEND_API_KEY",
  "EMAIL_FROM",
] as const;

// Present in every environment, but only worth a warning when absent.
const RECOMMENDED = ["SUPERTOKENS_API_KEY", "APP_DOMAIN"] as const;

export function checkEnv(env: NodeJS.ProcessEnv = process.env): void {
  const missing = REQUIRED_IN_PRODUCTION.filter((key) => !env[key]?.trim());

  if (env.NODE_ENV === "production") {
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
    }
    if (env.STRIPE_ENABLED === "true") {
      const stripeMissing = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"].filter((k) => !env[k]?.trim());
      if (stripeMissing.length > 0) {
        throw new Error(`STRIPE_ENABLED is true but ${stripeMissing.join(", ")} is not set`);
      }
    }
  }

  const unset = RECOMMENDED.filter((key) => !env[key]?.trim());
  if (unset.length > 0) {
    console.warn(`⚠️  Not set (optional): ${unset.join(", ")}`);
  }
}

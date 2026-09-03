import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import supertokens from "supertokens-node";
import {
  middleware as stMiddleware,
  errorHandler as stErrorHandler,
} from "supertokens-node/framework/express";

import { initSupertokens } from "./lib/supertokens";
import { checkDatabaseConnection } from "../db/client";
import usersRoutes from "./modules/users/users.routes";
import jobsRoutes from "./modules/jobs/jobs.routes";
import companiesRoutes from "./modules/companies/companies.routes";
import uploadsRoutes from "./modules/uploads/uploads.routes";
import { errorHandler, notFoundHandler } from "./middleware/errorhandler";
import applicationsRoutes from "./modules/applications/applications.routes";
import savedJobsRoutes from "./modules/savedJobs/savedJobs.routes";
import workExperienceRoutes from "./modules/workExperience/workExperience.routes";
import tagsRoutes from "./modules/tags/tags.routes";
import notificationsRoutes from "./modules/notifications/notifications.routes";
import billingRoutes from "./modules/billing/billing.routes";
import billingWebhookRoutes from "./modules/billing/billing.webhookRoutes";
import adminRoutes from "./modules/admin/admin.routes";
import skillsCatalogRoutes from "./modules/skillsCatalog/skillsCatalog.routes";

initSupertokens();

const app = express();

// Needed behind a reverse proxy / load balancer (e.g. App Runner) so
// req.secure / req.ip and secure cookies reflect the real client, not the proxy hop.
app.set("trust proxy", 1);

const allowedOrigins = [
  process.env.WEBSITE_DOMAIN,      // Expo web dev server, e.g. http://localhost:8081
  process.env.APP_DOMAIN,          // any additional web-facing origin, if you have one
].filter(Boolean) as string[];

app.use(
  cors({
    origin: (origin, callback) => {
      // requests with no Origin header (native apps, curl, server-to-server)
      // are not subject to CORS at all — always allow them through here
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    allowedHeaders: ["content-type", ...supertokens.getAllCORSHeaders()],
    credentials: true,
  })
);

app.use(helmet());

// Handles all /auth/* routes (signup, signin, signout, session refresh, etc.)
app.use(stMiddleware());

// Must be registered BEFORE express.json() below — Stripe's webhook
// signature verification requires the exact raw request body bytes, not the
// re-serialized object express.json() would produce. First per-route
// body-parser override in this codebase; keep it ahead of the global parser.
app.use("/api/v1/billing/webhook", express.raw({ type: "application/json" }), billingWebhookRoutes);

app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


app.get("/health", async (_, res) => {
  try {
    await checkDatabaseConnection();
    res.status(200).json({ success: true, message: "API is running" });
  } catch {
    res.status(503).json({ success: false, message: "Database unreachable" });
  }
});

// Must come before the "/api/v1/users" mount below — otherwise usersRoutes'
// own "/:id" route would swallow this more specific path first.
app.use("/api/v1/users/me/experience", workExperienceRoutes);
app.use("/api/v1/users", usersRoutes);
app.use("/api/v1/jobs", jobsRoutes);
app.use("/api/v1/companies", companiesRoutes);
app.use("/api/v1/uploads", uploadsRoutes);
app.use("/api/v1/applications", applicationsRoutes);
app.use("/api/v1/saved-jobs", savedJobsRoutes);
app.use("/api/v1/tags", tagsRoutes);
app.use("/api/v1/notifications", notificationsRoutes);
app.use("/api/v1/billing", billingRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/skills-catalog", skillsCatalogRoutes);

app.use(notFoundHandler);

// SuperTokens error handler must come before ours so it handles session
// errors (expired/invalid tokens) with its own response format.
app.use(stErrorHandler());
app.use(errorHandler);

export default app;

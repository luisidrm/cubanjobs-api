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
import usersRoutes from "./modules/users/users.routes";
import jobsRoutes from "./modules/jobs/jobs.routes";
import companiesRoutes from "./modules/companies/companies.routes";
import uploadsRoutes from "./modules/uploads/uploads.routes";
import { errorHandler, notFoundHandler } from "./middleware/errorhandler";

initSupertokens();

const app = express();

app.use(
  cors({
    origin: process.env.WEBSITE_DOMAIN ?? "http://localhost:5173",
    allowedHeaders: ["content-type", ...supertokens.getAllCORSHeaders()],
    credentials: true,
  })
);

app.use(helmet());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Handles all /auth/* routes (signup, signin, signout, session refresh, etc.)
app.use(stMiddleware());

app.get("/health", (_, res) => {
  res.status(200).json({ success: true, message: "API is running" });
});

app.use("/api/v1/users", usersRoutes);
app.use("/api/v1/jobs", jobsRoutes);
app.use("/api/v1/companies", companiesRoutes);
app.use("/api/v1/uploads", uploadsRoutes);

app.use(notFoundHandler);

// SuperTokens error handler must come before ours so it handles session
// errors (expired/invalid tokens) with its own response format.
app.use(stErrorHandler());
app.use(errorHandler);

export default app;

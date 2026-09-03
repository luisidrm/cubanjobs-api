import { Router } from "express";
import { handleWebhook } from "./billing.controller";

// Deliberately its own router, mounted in app.ts with express.raw() BEFORE
// the global express.json() call — Stripe's signature verification needs
// the exact raw body bytes. No requireAuth: Stripe calls this directly.
const router = Router();

router.post("/", handleWebhook);

export default router;

import { Router } from "express";
import type { z } from "zod";
import { validateBody, validateParams, validateQuery, getValidatedParams, getValidatedQuery } from "../../middleware/validate";
import { approvePayment, rejectPayment, setPlanManually } from "../subscriptions/subscriptions.service";
import { getAdminMetrics } from "./adminMetrics.queries";
import {
  countPendingPayments,
  getAllPlansForAdmin,
  getAllSettings,
  getExpiringAccounts,
  getPaymentDetail,
  getPlanHistory,
  listPayments,
  searchAccounts,
  updatePlan,
  updateSettings,
  upsertPlanPrice,
} from "./adminPayments.queries";
import {
  accountSearchQuerySchema,
  expiringQuerySchema,
  idParamSchema,
  listPaymentsQuerySchema,
  planPriceParamSchema,
  rejectPaymentSchema,
  setCompanyPlanSchema,
  setUserPlanSchema,
  updatePlanSchema,
  updateSettingsSchema,
  upsertPriceSchema,
} from "./adminPayments.schemas";

type IdParams = z.infer<typeof idParamSchema>;

/**
 * Admin-only payments and plans API. Mounted under /api/v1/admin by
 * admin.routes.ts, which already applies requireAuth + requireRole("admin").
 */
const router = Router();

// ---- Overview metrics ----------------------------------------------------

router.get("/metrics", async (_req, res) => {
  res.status(200).json({ success: true, data: await getAdminMetrics() });
});

// ---- Payments queue ------------------------------------------------------

router.get("/payments", validateQuery(listPaymentsQuerySchema), async (req, res) => {
  const { status, limit, offset } = getValidatedQuery<z.infer<typeof listPaymentsQuerySchema>>(req);
  const [data, pending] = await Promise.all([listPayments(status, limit, offset), countPendingPayments()]);
  res.status(200).json({ success: true, data, meta: { pending } });
});

router.get("/payments/:id", validateParams(idParamSchema), async (req, res) => {
  const { id } = getValidatedParams<IdParams>(req);
  res.status(200).json({ success: true, data: await getPaymentDetail(id) });
});

router.post("/payments/:id/approve", validateParams(idParamSchema), async (req, res) => {
  const { id } = getValidatedParams<IdParams>(req);
  const { payment, planCode, expiresAt } = await approvePayment(id, req.user!.id);
  res.status(200).json({ success: true, data: { id: payment.id, status: payment.status, planCode, expiresAt } });
});

router.post("/payments/:id/reject", validateParams(idParamSchema), validateBody(rejectPaymentSchema), async (req, res) => {
  const { id } = getValidatedParams<IdParams>(req);
  const payment = await rejectPayment(id, req.user!.id, req.body.reason);
  res.status(200).json({ success: true, data: { id: payment.id, status: payment.status, rejectReason: payment.rejectReason } });
});

// ---- Accounts ------------------------------------------------------------

router.get("/accounts/search", validateQuery(accountSearchQuerySchema), async (req, res) => {
  const { q } = getValidatedQuery<z.infer<typeof accountSearchQuerySchema>>(req);
  res.status(200).json({ success: true, data: await searchAccounts(q) });
});

router.get("/accounts/expiring", validateQuery(expiringQuerySchema), async (req, res) => {
  const { days } = getValidatedQuery<z.infer<typeof expiringQuerySchema>>(req);
  res.status(200).json({ success: true, data: await getExpiringAccounts(days) });
});

router.get("/accounts/user/:id/history", validateParams(idParamSchema), async (req, res) => {
  const { id } = getValidatedParams<IdParams>(req);
  res.status(200).json({ success: true, data: await getPlanHistory({ userId: id }) });
});

router.get("/accounts/company/:id/history", validateParams(idParamSchema), async (req, res) => {
  const { id } = getValidatedParams<IdParams>(req);
  res.status(200).json({ success: true, data: await getPlanHistory({ companyId: id }) });
});

router.put("/accounts/user/:id/plan", validateParams(idParamSchema), validateBody(setUserPlanSchema), async (req, res) => {
  const { id } = getValidatedParams<IdParams>(req);
  await setPlanManually({ userId: id, plan: req.body.plan }, req.body.expiresAt, req.user!.id, req.body.note);
  res.status(200).json({ success: true });
});

router.put("/accounts/company/:id/plan", validateParams(idParamSchema), validateBody(setCompanyPlanSchema), async (req, res) => {
  const { id } = getValidatedParams<IdParams>(req);
  await setPlanManually({ companyId: id, plan: req.body.plan }, req.body.expiresAt, req.user!.id, req.body.note);
  res.status(200).json({ success: true });
});

// ---- Plans, prices, settings ---------------------------------------------

router.get("/plans", async (_req, res) => {
  res.status(200).json({ success: true, data: await getAllPlansForAdmin() });
});

router.patch("/plans/:id", validateParams(idParamSchema), validateBody(updatePlanSchema), async (req, res) => {
  const { id } = getValidatedParams<IdParams>(req);
  res.status(200).json({ success: true, data: await updatePlan(id, req.body) });
});

router.put("/plans/:id/prices/:months", validateParams(planPriceParamSchema), validateBody(upsertPriceSchema), async (req, res) => {
  const { id, months } = getValidatedParams<z.infer<typeof planPriceParamSchema>>(req);
  res.status(200).json({ success: true, data: await upsertPlanPrice(id, months, req.body.priceCup, req.body.isActive) });
});

router.get("/payment-settings", async (_req, res) => {
  res.status(200).json({ success: true, data: await getAllSettings() });
});

router.put("/payment-settings", validateBody(updateSettingsSchema), async (req, res) => {
  res.status(200).json({ success: true, data: await updateSettings(req.body) });
});

export default router;

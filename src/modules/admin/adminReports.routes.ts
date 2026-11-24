import { Router } from "express";
import type { z } from "zod";
import { getValidatedParams, getValidatedQuery, validateBody, validateParams, validateQuery } from "../../middleware/validate";
import { countOpenReports, listReports, resolveReport } from "../reports/reports.queries";
import {
  listReportsQuerySchema,
  reportIdParamSchema,
  resolveReportSchema,
  type ResolveReportInput,
} from "../reports/reports.schemas";

/** Admin report queue. Mounted under /api/v1/admin, which already requires the admin role. */
const router = Router();

router.get("/reports", validateQuery(listReportsQuerySchema), async (req, res) => {
  const query = getValidatedQuery<z.infer<typeof listReportsQuerySchema>>(req);
  res.status(200).json({ success: true, data: await listReports(query) });
});

router.get("/reports/open-count", async (_req, res) => {
  res.status(200).json({ success: true, data: { open: await countOpenReports() } });
});

router.patch("/reports/:id", validateParams(reportIdParamSchema), validateBody(resolveReportSchema), async (req, res) => {
  const { id } = getValidatedParams<z.infer<typeof reportIdParamSchema>>(req);
  const data = await resolveReport(id, req.user!.id, req.body as ResolveReportInput);
  res.status(200).json({ success: true, data });
});

export default router;

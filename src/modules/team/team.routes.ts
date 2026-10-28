import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth, requireRole, requireVerifiedEmail } from "../../middleware/auth";
import { joinLimiter } from "../../middleware/rateLimit";
import { getValidatedParams, validateBody, validateParams } from "../../middleware/validate";
import { createInvite, getTeam, joinByCode, removeMember, revokeInvite } from "./team.queries";
import { joinSchema, teamMemberParamSchema, teamParamSchema } from "./team.schemas";

// Mounted at /api/v1/companies before the companies router, so "/join" is not
// swallowed by its "/:id" route.
const router = Router();

router.post(
  "/join",
  joinLimiter,
  requireAuth,
  requireRole("employer"),
  requireVerifiedEmail,
  validateBody(joinSchema),
  async (req: Request, res: Response) => {
    const company = await joinByCode(req.user!, req.body.code);
    res.status(200).json({ success: true, data: company });
  }
);

router.get(
  "/:id/team",
  requireAuth,
  requireRole("employer", "admin"),
  validateParams(teamParamSchema),
  async (req: Request, res: Response) => {
    const { id } = getValidatedParams<{ id: string }>(req);
    res.status(200).json({ success: true, data: await getTeam(req.user!, id) });
  }
);

router.post(
  "/:id/invite",
  requireAuth,
  requireRole("employer", "admin"),
  validateParams(teamParamSchema),
  async (req: Request, res: Response) => {
    const { id } = getValidatedParams<{ id: string }>(req);
    res.status(201).json({ success: true, data: await createInvite(req.user!, id) });
  }
);

router.delete(
  "/:id/invite",
  requireAuth,
  requireRole("employer", "admin"),
  validateParams(teamParamSchema),
  async (req: Request, res: Response) => {
    const { id } = getValidatedParams<{ id: string }>(req);
    await revokeInvite(req.user!, id);
    res.status(204).send();
  }
);

router.delete(
  "/:id/team/:userId",
  requireAuth,
  requireRole("employer", "admin"),
  validateParams(teamMemberParamSchema),
  async (req: Request, res: Response) => {
    const { id, userId } = getValidatedParams<{ id: string; userId: string }>(req);
    await removeMember(req.user!, id, userId);
    res.status(204).send();
  }
);

export default router;

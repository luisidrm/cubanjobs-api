import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { users } from "../../../db";
import {
  uploadPublicFile,
  uploadPrivateFile,
  mimeToExt,
  deletePublicFile,
  getSignedUrl,
  PUBLIC_BUCKET,
} from "../../lib/minio";
import { updateCompanyLogo, getCompanyById } from "../companies/companies.queries";
import { AppError } from "../../lib/AppError";

export async function uploadAvatar(req: Request, res: Response) {
  if (!req.file) throw new AppError(400, "No file provided");

  const ext = mimeToExt(req.file.mimetype);
  const objectName = `profiles/${req.user!.id}/avatar.${ext}`;

  const url = await uploadPublicFile(req.file.buffer, objectName, req.file.mimetype);

  await db.update(users).set({ profilePictureUrl: url }).where(eq(users.id, req.user!.id));

  res.status(200).json({ success: true, data: { url } });
}

export async function uploadCv(req: Request, res: Response) {
  if (!req.file) throw new AppError(400, "No file provided");

  const objectName = `profiles/${req.user!.id}/cv.pdf`;

  await uploadPrivateFile(req.file.buffer, objectName, req.file.mimetype);

  await db.update(users).set({ cvUrl: objectName }).where(eq(users.id, req.user!.id));

  res.status(200).json({ success: true, data: { objectName } });
}

export async function getCvUrl(req: Request, res: Response) {
  const [user] = await db
    .select({ cvUrl: users.cvUrl })
    .from(users)
    .where(eq(users.id, req.user!.id));

  if (!user?.cvUrl) throw new AppError(404, "No CV uploaded yet");

  const signedUrl = await getSignedUrl(user.cvUrl);
  res.status(200).json({ success: true, data: { url: signedUrl } });
}

export async function uploadCompanyLogo(req: Request, res: Response) {
  if (!req.file) throw new AppError(400, "No file provided");

  const companyId = req.params.companyId;

  const company = await getCompanyById(companyId);
  if (req.user!.role !== "admin" && company.ownerId !== req.user!.id) {
    throw new AppError(403, "You do not own this company");
  }

  const ext = mimeToExt(req.file.mimetype);
  const objectName = `companies/${companyId}/logo.${ext}`;

  // Upload + commit first — only delete the old logo once the new one
  // is confirmed live, so a failure never leaves the company logo-less.
  const url = await uploadPublicFile(req.file.buffer, objectName, req.file.mimetype);
  const updated = await updateCompanyLogo(req.user!, companyId, url);

  if (company.logoUrl && company.logoUrl !== url) {
    const oldObjectName = company.logoUrl.split(`/${PUBLIC_BUCKET}/`)[1];
    if (oldObjectName) await deletePublicFile(oldObjectName).catch(() => null);
  }

  res.status(200).json({ success: true, data: updated });
}
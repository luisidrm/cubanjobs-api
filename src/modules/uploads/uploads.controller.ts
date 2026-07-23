import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { users } from "../../../db";
import { uploadFile, mimeToExt, deleteFile, getSignedUrl } from "../../lib/minio";
import { updateCompanyLogo, getCompanyById } from "../companies/companies.queries";
import { AppError } from "../../lib/AppError";

/** POST /api/v1/uploads/avatar */
export async function uploadAvatar(req: Request, res: Response) {
  if (!req.file) throw new AppError(400, "No file provided");

  const ext = mimeToExt(req.file.mimetype);
  const objectName = `profiles/${req.user!.id}/avatar.${ext}`;

  const url = await uploadFile(req.file.buffer, objectName, req.file.mimetype);

  await db
    .update(users)
    .set({ profilePictureUrl: url })
    .where(eq(users.id, req.user!.id));

  res.status(200).json({ success: true, data: { url } });
}

/** POST /api/v1/uploads/cv */
export async function uploadCv(req: Request, res: Response) {
  if (!req.file) throw new AppError(400, "No file provided");

  const objectName = `profiles/${req.user!.id}/cv.pdf`;

  await uploadFile(req.file.buffer, objectName, req.file.mimetype);

  // CVs are private — we store the object path, not a public URL
  await db
    .update(users)
    .set({ cvUrl: objectName })
    .where(eq(users.id, req.user!.id));

  res.status(200).json({ success: true, data: { objectName } });
}

/** GET /api/v1/uploads/cv — returns a 1-hour pre-signed URL for the caller's CV */
export async function getCvUrl(req: Request, res: Response) {
  const [user] = await db
    .select({ cvUrl: users.cvUrl })
    .from(users)
    .where(eq(users.id, req.user!.id));

  if (!user?.cvUrl) throw new AppError(404, "No CV uploaded yet");

  const signedUrl = await getSignedUrl(user.cvUrl);
  res.status(200).json({ success: true, data: { url: signedUrl } });
}

/** POST /api/v1/uploads/company-logo/:companyId */
export async function uploadCompanyLogo(req: Request, res: Response) {
  if (!req.file) throw new AppError(400, "No file provided");

  const companyId = req.params.companyId;

  // Verify ownership before accepting the file
  const company = await getCompanyById(companyId);
  if (company.ownerId !== req.user!.id) {
    throw new AppError(403, "You do not own this company");
  }

  // Delete the old logo if one exists
  if (company.logoUrl) {
    const oldObjectName = company.logoUrl.split(`/cuban-jobs/`)[1];
    if (oldObjectName) await deleteFile(oldObjectName).catch(() => null);
  }

  const ext = mimeToExt(req.file.mimetype);
  const objectName = `companies/${companyId}/logo.${ext}`;

  const url = await uploadFile(req.file.buffer, objectName, req.file.mimetype);
  const updated = await updateCompanyLogo(req.user!.id, companyId, url);

  res.status(200).json({ success: true, data: updated });
}

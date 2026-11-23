import { Router } from "express";
import multer from "multer";
import { uploadAvatar, uploadCv, getCvUrl, uploadCompanyLogo, uploadJobImage, deleteJobImage } from "./uploads.controller";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateParams } from "../../middleware/validate";
import { companyLogoParamSchema, jobImageParamSchema } from "./uploads.schema";
import { AppError } from "../../lib/AppError";
import { verifyFileSignature } from "../../middleware/fileSignature";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PDF_TYPE = "application/pdf";

function makeUpload(allowedTypes: string[], maxSizeMb: number) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxSizeMb * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new AppError(400, `Invalid file type. Allowed: ${allowedTypes.join(", ")}`));
      }
    },
  });
}

const imageUpload = makeUpload(IMAGE_TYPES, 5);
const pdfUpload = makeUpload([PDF_TYPE], 10);

const router = Router();

router.post("/avatar", requireAuth, imageUpload.single("file"), verifyFileSignature, uploadAvatar);

router.post(
  "/cv",
  requireAuth,
  requireRole("employee"),
  pdfUpload.single("file"), verifyFileSignature,
  uploadCv
);

router.get("/cv", requireAuth, requireRole("employee"), getCvUrl);

router.post(
  "/company-logo/:companyId",
  requireAuth,
  requireRole("employer", "admin"),
  validateParams(companyLogoParamSchema),
  imageUpload.single("file"), verifyFileSignature,
  uploadCompanyLogo
);

router.post(
  "/job-image/:jobId",
  requireAuth,
  requireRole("employer", "admin"),
  validateParams(jobImageParamSchema),
  imageUpload.single("file"), verifyFileSignature,
  uploadJobImage
);

router.delete(
  "/job-image/:jobId",
  requireAuth,
  requireRole("employer", "admin"),
  validateParams(jobImageParamSchema),
  deleteJobImage
);

export default router;

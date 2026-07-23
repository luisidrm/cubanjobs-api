import { Router } from "express";
import multer from "multer";
import { uploadAvatar, uploadCv, getCvUrl, uploadCompanyLogo } from "./uploads.controller";
import { requireAuth, requireRole } from "../../middleware/auth";
import { AppError } from "../../lib/AppError";

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

// Profile picture — any authenticated user
router.post(
  "/avatar",
  requireAuth,
  imageUpload.single("file"),
  uploadAvatar
);

// CV — employees only
router.post(
  "/cv",
  requireAuth,
  requireRole("employee"),
  pdfUpload.single("file"),
  uploadCv
);

// Get a pre-signed URL to download own CV — employees only
router.get(
  "/cv",
  requireAuth,
  requireRole("employee"),
  getCvUrl
);

// Company logo — employers only
router.post(
  "/company-logo/:companyId",
  requireAuth,
  requireRole("employer"),
  imageUpload.single("file"),
  uploadCompanyLogo
);

export default router;

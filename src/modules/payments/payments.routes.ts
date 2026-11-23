import { Router } from "express";
import multer from "multer";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { AppError } from "../../lib/AppError";
import { getMyPayments, submitPayment } from "./payments.queries";
import { submitPaymentSchema, type SubmitPaymentInput } from "./payments.schemas";
import { verifyFileSignature } from "../../middleware/fileSignature";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Screenshots are proof for the admin only: images, small, kept in memory
// just long enough to be written to the private bucket.
const screenshotUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (IMAGE_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new AppError(400, `Invalid file type. Allowed: ${IMAGE_TYPES.join(", ")}`));
  },
});

const router = Router();

router.post(
  "/",
  requireAuth,
  requireRole("employee", "employer"),
  screenshotUpload.single("screenshot"), verifyFileSignature,
  validateBody(submitPaymentSchema),
  async (req, res) => {
    const payment = await submitPayment(
      { id: req.user!.id, email: req.user!.email, role: req.user!.role },
      req.body as SubmitPaymentInput,
      req.file ? { buffer: req.file.buffer, mimetype: req.file.mimetype } : undefined
    );
    res.status(201).json({
      success: true,
      data: {
        id: payment.id,
        status: payment.status,
        amountCup: payment.amountCup,
        months: payment.months,
        createdAt: payment.createdAt,
      },
    });
  }
);

router.get("/mine", requireAuth, async (req, res) => {
  res.status(200).json({ success: true, data: await getMyPayments(req.user!.id) });
});

export default router;

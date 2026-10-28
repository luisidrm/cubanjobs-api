import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth, requireRole } from "../../middleware/auth";
import { requireFreelancerAccess, requirePaidPoster } from "../../middleware/plan";
import { getValidatedParams, getValidatedQuery, validateBody, validateParams, validateQuery } from "../../middleware/validate";
import { AppError } from "../../lib/AppError";
import { PUBLIC_BUCKET, deletePublicFile, mimeToExt, uploadPublicFile } from "../../lib/minio";
import {
  addImage,
  createPost,
  deletePost,
  getMyPosts,
  getOwnedPost,
  getPostDetail,
  listPosts,
  removeImage,
  updatePost,
} from "./freelancerPosts.queries";
import {
  MAX_IMAGES_PER_POST,
  createPostSchema,
  listPostsQuerySchema,
  postIdParamSchema,
  removeImageQuerySchema,
  updatePostSchema,
  type ListPostsQuery,
} from "./freelancerPosts.schemas";

type IdParams = z.infer<typeof postIdParamSchema>;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    IMAGE_TYPES.includes(file.mimetype)
      ? cb(null, true)
      : cb(new AppError(400, `Invalid file type. Allowed: ${IMAGE_TYPES.join(", ")}`)),
});

/** Public-bucket object name from a stored URL, or null if it isn't one of ours. */
const objectNameFromUrl = (url: string): string | null => url.split(`/${PUBLIC_BUCKET}/`)[1] ?? null;

async function deleteImages(urls: string[]) {
  await Promise.all(
    urls.map((u) => {
      const name = objectNameFromUrl(u);
      return name ? deletePublicFile(name).catch(() => null) : null;
    })
  );
}

const router = Router();

// Posting and managing: paying employees only. Declared before "/:id" so
// "/mine" isn't read as an id.
router.get("/mine", requireAuth, requireRole("employee"), async (req: Request, res: Response) => {
  res.status(200).json({ success: true, data: await getMyPosts(req.user!.id) });
});

router.post("/", requireAuth, requireRole("employee"), requirePaidPoster, validateBody(createPostSchema), async (req, res) => {
  res.status(201).json({ success: true, data: await createPost(req.user!, req.body) });
});

// Browsing: paying employees, paid companies and admins.
router.get("/", requireAuth, requireFreelancerAccess, validateQuery(listPostsQuerySchema), async (req, res) => {
  const data = await listPosts(getValidatedQuery<ListPostsQuery>(req));
  res.status(200).json({ success: true, data });
});

// Owners can always open their own post, even after their plan lapses;
// everyone else needs the same access as the list.
async function requireViewerOrOwner(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.user!.role === "employee") {
      const { id } = getValidatedParams<IdParams>(req);
      const owned = await getOwnedPost(req.user!, id).then(
        () => true,
        () => false
      );
      if (owned) return next();
    }
    return requireFreelancerAccess(req, res, next);
  } catch (e) {
    return next(e);
  }
}

router.get("/:id", requireAuth, validateParams(postIdParamSchema), requireViewerOrOwner, async (req, res) => {
  const { id } = getValidatedParams<IdParams>(req);
  res.status(200).json({ success: true, data: await getPostDetail(req.user!, id) });
});

router.patch("/:id", requireAuth, requireRole("employee", "admin"), validateParams(postIdParamSchema), validateBody(updatePostSchema), async (req, res) => {
  const { id } = getValidatedParams<IdParams>(req);
  res.status(200).json({ success: true, data: await updatePost(req.user!, id, req.body) });
});

router.delete("/:id", requireAuth, requireRole("employee", "admin"), validateParams(postIdParamSchema), async (req, res) => {
  const { id } = getValidatedParams<IdParams>(req);
  const removed = await deletePost(req.user!, id);
  await deleteImages(removed.images);
  res.status(204).send();
});

router.post(
  "/:id/images",
  requireAuth,
  requireRole("employee", "admin"),
  validateParams(postIdParamSchema),
  imageUpload.single("file"),
  async (req, res) => {
    if (!req.file) throw new AppError(400, "No file provided");
    const { id } = getValidatedParams<IdParams>(req);
    const post = await getOwnedPost(req.user!, id);
    if (post.images.length >= MAX_IMAGES_PER_POST) {
      throw new AppError(409, `A post can have up to ${MAX_IMAGES_PER_POST} images`, { code: "IMAGE_LIMIT_REACHED" });
    }

    const objectName = `freelancer/${id}/${Date.now()}.${mimeToExt(req.file.mimetype)}`;
    const url = await uploadPublicFile(req.file.buffer, objectName, req.file.mimetype);
    const updated = await addImage(id, url);
    if (!updated) {
      // Lost a race with another upload: don't leave an orphan in storage.
      await deleteImages([url]);
      throw new AppError(409, `A post can have up to ${MAX_IMAGES_PER_POST} images`, { code: "IMAGE_LIMIT_REACHED" });
    }
    res.status(200).json({ success: true, data: updated });
  }
);

router.delete("/:id/images", requireAuth, requireRole("employee", "admin"), validateParams(postIdParamSchema), validateQuery(removeImageQuerySchema), async (req, res) => {
  const { id } = getValidatedParams<IdParams>(req);
  const { url } = getValidatedQuery<{ url: string }>(req);
  const post = await getOwnedPost(req.user!, id);
  if (!post.images.includes(url)) throw new AppError(404, "Image not found on this post");
  const updated = await removeImage(id, url);
  await deleteImages([url]);
  res.status(200).json({ success: true, data: updated });
});

export default router;

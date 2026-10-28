import { z } from "zod";

export const MAX_POSTS_PER_USER = 3;
export const MAX_IMAGES_PER_POST = 5;

const emptyToNull = (v: string) => (v === "" ? null : v);

const optionalText = (max: number) => z.string().trim().max(max).transform(emptyToNull).nullable().optional();

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .transform(emptyToNull)
  .nullable()
  .optional()
  .refine((v) => v == null || /^https?:\/\/\S+$/i.test(v), "Link must start with http:// or https://");

const contactEmail = z
  .string()
  .trim()
  .max(255)
  .transform(emptyToNull)
  .nullable()
  .optional()
  .refine((v) => v == null || z.email().safeParse(v).success, "Invalid email");

const postFields = {
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(5000),
  linkUrl: httpUrl,
  contactPhone: optionalText(32),
  contactWhatsapp: optionalText(32),
  contactEmail,
  contactTelegram: optionalText(64),
};

const CONTACT_KEYS = ["contactPhone", "contactWhatsapp", "contactEmail", "contactTelegram"] as const;

export const hasContact = (v: Partial<Record<(typeof CONTACT_KEYS)[number], string | null | undefined>>) =>
  CONTACT_KEYS.some((k) => !!v[k]);

export const createPostSchema = z
  .object(postFields)
  .refine(hasContact, { message: "Add at least one way to contact you", path: ["contactPhone"] });

export const updatePostSchema = z.object(postFields).partial();

export const postIdParamSchema = z.object({ id: z.uuidv4() });

export const listPostsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const removeImageQuerySchema = z.object({ url: z.string().url().max(1000) });

export type CreatePostInput = z.infer<typeof createPostSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;
export type ListPostsQuery = z.infer<typeof listPostsQuerySchema>;

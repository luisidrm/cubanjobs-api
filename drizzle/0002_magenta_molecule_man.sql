ALTER TYPE "public"."application_status" ADD VALUE 'withdrawn';--> statement-breakpoint
ALTER TABLE "applications" ALTER COLUMN "resume_url" SET NOT NULL;
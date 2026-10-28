ALTER TYPE "public"."notification_type" ADD VALUE 'team_member_joined';--> statement-breakpoint
CREATE TABLE "company_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" varchar(16) NOT NULL,
	"created_by" uuid,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "company_invites_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "cover_image_url" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "seat_limit" integer;--> statement-breakpoint
ALTER TABLE "company_invites" ADD CONSTRAINT "company_invites_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_invites" ADD CONSTRAINT "company_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_invites_company_id_idx" ON "company_invites" USING btree ("company_id");
--> statement-breakpoint
UPDATE "plans" SET "seat_limit" = 3 WHERE "code" = 'basic';
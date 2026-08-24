CREATE TABLE "work_experience" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(150) NOT NULL,
	"organization" varchar(150),
	"description" text,
	"contact" varchar(255),
	"start_date" timestamp,
	"end_date" timestamp
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "linkedin_url" text;--> statement-breakpoint
ALTER TABLE "work_experience" ADD CONSTRAINT "work_experience_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_experience_user_id_idx" ON "work_experience" USING btree ("user_id");
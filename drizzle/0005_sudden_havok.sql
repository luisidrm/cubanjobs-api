CREATE TYPE "public"."company_member_role" AS ENUM('owner', 'admin');--> statement-breakpoint
CREATE TABLE "company_members" (
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "company_member_role" DEFAULT 'admin' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "company_members_company_id_user_id_pk" PRIMARY KEY("company_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_members_user_id_idx" ON "company_members" USING btree ("user_id");--> statement-breakpoint
INSERT INTO "company_members" ("company_id", "user_id", "role", "created_at", "updated_at")
SELECT "id", "owner_id", 'owner', "created_at", "updated_at" FROM "companies" WHERE "owner_id" IS NOT NULL;
CREATE TYPE "public"."plan_source" AS ENUM('none', 'transfermovil', 'stripe', 'manual');--> statement-breakpoint
CREATE TYPE "public"."user_plan" AS ENUM('free', 'paid');--> statement-breakpoint
CREATE TYPE "public"."plan_audience" AS ENUM('employee', 'employer');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."plan_event_reason" AS ENUM('payment_approved', 'manual', 'expired', 'stripe');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'plan_expiring';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'plan_expired';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'payment_approved';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'payment_rejected';--> statement-breakpoint
CREATE TABLE "payment_settings" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"months" integer NOT NULL,
	"price_cup" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "plan_prices_plan_months_unique" UNIQUE("plan_id","months")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"audience" "plan_audience" NOT NULL,
	"name" varchar(100) NOT NULL,
	"job_limit" integer,
	"candidate_search" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "plans_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"payer_email" varchar(255) NOT NULL,
	"company_id" uuid,
	"plan_id" uuid NOT NULL,
	"months" integer NOT NULL,
	"amount_cup" integer NOT NULL,
	"transfer_number" varchar(64) NOT NULL,
	"transfer_number_normalized" varchar(64) NOT NULL,
	"screenshot_key" text,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp,
	"reject_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"company_id" uuid,
	"from_plan" varchar(50) NOT NULL,
	"to_plan" varchar(50) NOT NULL,
	"expires_at" timestamp,
	"reason" "plan_event_reason" NOT NULL,
	"payment_id" uuid,
	"actor_id" uuid,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan" "user_plan" DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan_source" "plan_source" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan_reminder_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "plan_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "plan_source" "plan_source" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "plan_reminder_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_events" ADD CONSTRAINT "plan_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_events" ADD CONSTRAINT "plan_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_events" ADD CONSTRAINT "plan_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_events" ADD CONSTRAINT "plan_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payments_user_id_idx" ON "payments" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_transfer_active_unique" ON "payments" USING btree ("transfer_number_normalized") WHERE "payments"."status" <> 'rejected';--> statement-breakpoint
CREATE INDEX "plan_events_user_id_idx" ON "plan_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "plan_events_company_id_idx" ON "plan_events" USING btree ("company_id");--> statement-breakpoint
-- Starting catalog. Prices are placeholders: edit them from the admin side (plan_prices).
INSERT INTO "plans" ("code", "audience", "name", "job_limit", "candidate_search", "sort_order") VALUES
  ('employee_paid', 'employee', 'Employee', NULL, false, 1),
  ('basic', 'employer', 'Basic', 10, true, 2),
  ('pro', 'employer', 'Pro', NULL, true, 3);
--> statement-breakpoint
INSERT INTO "plan_prices" ("plan_id", "months", "price_cup")
SELECT p."id", m."months", ROUND(base."price" * m."months")::int
FROM "plans" p
JOIN (VALUES ('employee_paid', 450), ('basic', 1500), ('pro', 3000)) AS base("code", "price") ON base."code" = p."code"
CROSS JOIN (VALUES (1), (3), (6)) AS m("months");
--> statement-breakpoint
INSERT INTO "payment_settings" ("key", "value") VALUES
  ('destination_card', 'CAMBIAR: numero de tarjeta Transfermovil'),
  ('destination_phone', 'CAMBIAR: telefono asociado'),
  ('destination_holder', 'CAMBIAR: nombre del titular'),
  ('instructions_es', 'Haz la transferencia desde Transfermovil al destino indicado y escribe aqui el numero de la transferencia.'),
  ('instructions_en', 'Make the transfer from Transfermovil to the destination shown and enter the transfer number here.'),
  ('reminder_days_before', '3');
--> statement-breakpoint
-- Companies already subscribed through Stripe are managed by Stripe, not by the expiry job.
UPDATE "companies" SET "plan_source" = 'stripe' WHERE "stripe_subscription_id" IS NOT NULL AND "plan_tier" <> 'free';

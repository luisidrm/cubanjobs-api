ALTER TABLE "companies" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "stripe_subscription_status" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "current_period_end" timestamp;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_stripe_customer_id_unique" UNIQUE("stripe_customer_id");
CREATE TABLE "freelancer_post_views" (
	"post_id" uuid NOT NULL,
	"viewer_id" uuid NOT NULL,
	"viewed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "freelancer_post_views_post_id_viewer_id_pk" PRIMARY KEY("post_id","viewer_id")
);
--> statement-breakpoint
CREATE TABLE "freelancer_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(120) NOT NULL,
	"description" text NOT NULL,
	"link_url" text,
	"contact_phone" varchar(32),
	"contact_whatsapp" varchar(32),
	"contact_email" varchar(255),
	"contact_telegram" varchar(64),
	"images" text[] DEFAULT '{}' NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "freelancer_post_views" ADD CONSTRAINT "freelancer_post_views_post_id_freelancer_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."freelancer_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freelancer_post_views" ADD CONSTRAINT "freelancer_post_views_viewer_id_users_id_fk" FOREIGN KEY ("viewer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "freelancer_posts" ADD CONSTRAINT "freelancer_posts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "freelancer_posts_user_id_idx" ON "freelancer_posts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "freelancer_posts_created_at_idx" ON "freelancer_posts" USING btree ("created_at");
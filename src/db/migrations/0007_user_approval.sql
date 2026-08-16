CREATE TYPE "public"."user_status" AS ENUM('PENDING', 'ACTIVE', 'REJECTED', 'DEACTIVATED');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" "user_status" DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_unique" ON "users" USING btree ("username");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "users" SET "status" = 'DEACTIVATED' WHERE "is_active" = false;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_status_matches_active" CHECK ("users"."is_active" = ("users"."status" = 'ACTIVE'));

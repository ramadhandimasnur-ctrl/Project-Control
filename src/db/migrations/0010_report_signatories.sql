CREATE TYPE "public"."signatory_slot" AS ENUM('PREPARED_BY', 'CHECKED_BY', 'APPROVED_BY');--> statement-breakpoint
CREATE TABLE "project_signatories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"slot" "signatory_slot" NOT NULL,
	"name" text NOT NULL,
	"position" text NOT NULL,
	"signature_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "project_signatories" ADD CONSTRAINT "project_signatories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_signatories" ADD CONSTRAINT "project_signatories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_signatories" ADD CONSTRAINT "project_signatories_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_signatories_slot_unique" ON "project_signatories" USING btree ("project_id","slot");
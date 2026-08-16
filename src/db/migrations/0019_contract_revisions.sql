CREATE TYPE "public"."contract_revision_status" AS ENUM('DRAFT', 'APPROVED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "contract_baseline_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"baseline_id" uuid NOT NULL,
	"work_item_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"unit_code" text NOT NULL,
	"volume" numeric(18, 4) DEFAULT '0' NOT NULL,
	"unit_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"weight" numeric(9, 6) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "contract_baselines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"contract_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"frozen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"frozen_by" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "contract_revision_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"volume_before" numeric(18, 4) DEFAULT '0' NOT NULL,
	"volume_after" numeric(18, 4) DEFAULT '0' NOT NULL,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "contract_revision_lines_nonneg" CHECK ("contract_revision_lines"."volume_before" >= 0 AND "contract_revision_lines"."volume_after" >= 0)
);
--> statement-breakpoint
CREATE TABLE "contract_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"title" text NOT NULL,
	"reason" text,
	"effective_date" date NOT NULL,
	"status" "contract_revision_status" DEFAULT 'DRAFT' NOT NULL,
	"contract_value_before" numeric(18, 2),
	"contract_value_after" numeric(18, 2),
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "contract_revisions_seq_positive" CHECK ("contract_revisions"."seq" >= 1)
);
--> statement-breakpoint
ALTER TABLE "contract_baseline_items" ADD CONSTRAINT "contract_baseline_items_baseline_id_contract_baselines_id_fk" FOREIGN KEY ("baseline_id") REFERENCES "public"."contract_baselines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_baseline_items" ADD CONSTRAINT "contract_baseline_items_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_baseline_items" ADD CONSTRAINT "contract_baseline_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_baseline_items" ADD CONSTRAINT "contract_baseline_items_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_baselines" ADD CONSTRAINT "contract_baselines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_baselines" ADD CONSTRAINT "contract_baselines_frozen_by_users_id_fk" FOREIGN KEY ("frozen_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_baselines" ADD CONSTRAINT "contract_baselines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_baselines" ADD CONSTRAINT "contract_baselines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_revision_lines" ADD CONSTRAINT "contract_revision_lines_revision_id_contract_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."contract_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_revision_lines" ADD CONSTRAINT "contract_revision_lines_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_revision_lines" ADD CONSTRAINT "contract_revision_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_revision_lines" ADD CONSTRAINT "contract_revision_lines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_revisions" ADD CONSTRAINT "contract_revisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_revisions" ADD CONSTRAINT "contract_revisions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_revisions" ADD CONSTRAINT "contract_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_revisions" ADD CONSTRAINT "contract_revisions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_baseline_items_baseline_idx" ON "contract_baseline_items" USING btree ("baseline_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_baselines_project_unique" ON "contract_baselines" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_revision_lines_unique" ON "contract_revision_lines" USING btree ("revision_id","work_item_id");--> statement-breakpoint
CREATE INDEX "contract_revision_lines_revision_idx" ON "contract_revision_lines" USING btree ("revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_revisions_project_seq_unique" ON "contract_revisions" USING btree ("project_id","seq");--> statement-breakpoint
CREATE INDEX "contract_revisions_project_idx" ON "contract_revisions" USING btree ("project_id");
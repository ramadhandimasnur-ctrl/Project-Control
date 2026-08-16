ALTER TABLE "progress_documents" DROP CONSTRAINT "progress_documents_progress_entry_id_progress_entries_id_fk";
--> statement-breakpoint
ALTER TABLE "progress_documents" ALTER COLUMN "progress_entry_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "progress_documents" ADD COLUMN "project_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "progress_documents" ADD COLUMN "period_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "progress_documents" ADD COLUMN "work_item_id" uuid;--> statement-breakpoint
ALTER TABLE "progress_documents" ADD COLUMN "byte_size" integer;--> statement-breakpoint
ALTER TABLE "progress_documents" ADD CONSTRAINT "progress_documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_documents" ADD CONSTRAINT "progress_documents_period_id_schedule_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."schedule_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_documents" ADD CONSTRAINT "progress_documents_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_documents" ADD CONSTRAINT "progress_documents_progress_entry_id_progress_entries_id_fk" FOREIGN KEY ("progress_entry_id") REFERENCES "public"."progress_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "progress_documents_period_idx" ON "progress_documents" USING btree ("period_id","work_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "progress_documents_path_unique" ON "progress_documents" USING btree ("storage_path");
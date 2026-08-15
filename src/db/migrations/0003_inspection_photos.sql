ALTER TABLE "progress_documents" ALTER COLUMN "progress_entry_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "progress_documents" ADD COLUMN "checklist_id" uuid;--> statement-breakpoint
ALTER TABLE "progress_documents" ADD CONSTRAINT "progress_documents_checklist_id_work_item_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."work_item_checklists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "progress_documents_checklist_idx" ON "progress_documents" USING btree ("checklist_id");--> statement-breakpoint
ALTER TABLE "progress_documents" ADD CONSTRAINT "progress_documents_one_parent" CHECK (("progress_documents"."progress_entry_id" IS NULL) <> ("progress_documents"."checklist_id" IS NULL));
ALTER TABLE "progress_documents" DROP CONSTRAINT "progress_documents_one_parent";--> statement-breakpoint
ALTER TABLE "progress_documents" DROP CONSTRAINT "progress_documents_checklist_id_work_item_checklists_id_fk";
--> statement-breakpoint
DROP INDEX "progress_documents_checklist_idx";--> statement-breakpoint
ALTER TABLE "progress_documents" ALTER COLUMN "progress_entry_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "progress_documents" DROP COLUMN "checklist_id";
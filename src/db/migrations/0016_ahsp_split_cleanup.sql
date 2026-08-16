-- The reporting views read the old coefficient columns, so they block the drop.
-- They are rebuilt from db/views.sql by `npm run db:views`, which is the step
-- that follows every migration run.
DROP VIEW IF EXISTS v_material_requirement CASCADE;--> statement-breakpoint
DROP VIEW IF EXISTS v_project_cost_summary CASCADE;--> statement-breakpoint
DROP VIEW IF EXISTS v_work_item_weight CASCADE;--> statement-breakpoint
DROP VIEW IF EXISTS v_work_item_cost CASCADE;--> statement-breakpoint
ALTER TABLE "work_item_resources" DROP CONSTRAINT "work_item_resources_nonneg";--> statement-breakpoint
ALTER TABLE "work_item_resources" ALTER COLUMN "estimate_type" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_resources_unique" ON "work_item_resources" USING btree ("work_item_id","estimate_type","resource_id","role");--> statement-breakpoint
ALTER TABLE "work_item_resources" DROP COLUMN "coef_rab";--> statement-breakpoint
ALTER TABLE "work_item_resources" DROP COLUMN "coef_rap";--> statement-breakpoint
ALTER TABLE "work_item_resources" ADD CONSTRAINT "work_item_resources_nonneg" CHECK ("work_item_resources"."coef" >= 0 AND "work_item_resources"."waste_factor" >= 0);
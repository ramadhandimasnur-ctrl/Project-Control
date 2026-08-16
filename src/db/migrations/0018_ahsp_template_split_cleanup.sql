ALTER TABLE "ahsp_template_resources" DROP CONSTRAINT "ahsp_template_resources_nonneg";--> statement-breakpoint
ALTER TABLE "ahsp_template_resources" ALTER COLUMN "estimate_type" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ahsp_template_resources_unique" ON "ahsp_template_resources" USING btree ("template_id","estimate_type","resource_id","role");--> statement-breakpoint
ALTER TABLE "ahsp_template_resources" DROP COLUMN "coef_rab";--> statement-breakpoint
ALTER TABLE "ahsp_template_resources" DROP COLUMN "coef_rap";--> statement-breakpoint
ALTER TABLE "ahsp_template_resources" ADD CONSTRAINT "ahsp_template_resources_nonneg" CHECK ("ahsp_template_resources"."coef" >= 0 AND "ahsp_template_resources"."waste_factor" >= 0);
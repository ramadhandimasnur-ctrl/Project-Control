-- Same split as 0015, on the template library. The old key allowed one row per
-- resource and role; the split needs one per analysis.
DROP INDEX "ahsp_template_resources_unique";--> statement-breakpoint

ALTER TABLE "ahsp_template_resources" ADD COLUMN "estimate_type" "price_type";--> statement-breakpoint
ALTER TABLE "ahsp_template_resources" ADD COLUMN "coef" numeric(18, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint

UPDATE "ahsp_template_resources" SET "estimate_type" = 'RAB', "coef" = "coef_rab";--> statement-breakpoint

INSERT INTO "ahsp_template_resources" (
  "template_id", "resource_id", "role", "estimate_type", "coef",
  "waste_factor", "created_by", "updated_by", "created_at", "updated_at"
)
SELECT
  "template_id", "resource_id", "role", 'RAP', "coef_rap",
  "waste_factor", "created_by", "updated_by", "created_at", "updated_at"
FROM "ahsp_template_resources"
WHERE "estimate_type" = 'RAB' AND "coef_rap" > 0;--> statement-breakpoint

DELETE FROM "ahsp_template_resources" WHERE "estimate_type" = 'RAB' AND "coef" = 0;

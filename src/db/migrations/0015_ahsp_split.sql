-- The old key allowed one row per resource and role. The split needs two — one
-- per analysis — so it goes first and 0016 puts back a key that includes the
-- analysis the line belongs to.
DROP INDEX "work_item_resources_unique";--> statement-breakpoint

ALTER TABLE "work_item_resources" ADD COLUMN "estimate_type" "price_type";--> statement-breakpoint
ALTER TABLE "work_item_resources" ADD COLUMN "coef" numeric(18, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint

-- Every existing row becomes the budget line it already was.
UPDATE "work_item_resources" SET "estimate_type" = 'RAB', "coef" = "coef_rab";--> statement-breakpoint

-- …and gains an execution twin wherever it carried an execution coefficient.
INSERT INTO "work_item_resources" (
  "work_item_id", "resource_id", "role", "estimate_type", "coef",
  "waste_factor", "note", "sort_order", "created_by", "updated_by",
  "created_at", "updated_at"
)
SELECT
  "work_item_id", "resource_id", "role", 'RAP', "coef_rap",
  "waste_factor", "note", "sort_order", "created_by", "updated_by",
  "created_at", "updated_at"
FROM "work_item_resources"
WHERE "estimate_type" = 'RAB' AND "coef_rap" > 0;--> statement-breakpoint

-- A row that contributed nothing to the budget was only ever an execution
-- line. Keeping it as a zero-coefficient RAB row would print a resource in the
-- budget analysis that the budget never bought.
DELETE FROM "work_item_resources" WHERE "estimate_type" = 'RAB' AND "coef" = 0;

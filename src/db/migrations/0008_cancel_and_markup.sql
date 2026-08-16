ALTER TYPE "public"."progress_status" ADD VALUE 'CANCELLED';--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "price_markup_percent" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_price_markup_nonneg" CHECK ("resources"."price_markup_percent" IS NULL OR "resources"."price_markup_percent" >= 0);
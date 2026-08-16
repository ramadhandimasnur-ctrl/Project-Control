ALTER TABLE "projects" ADD COLUMN "count_saturday" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "count_sunday" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Carry the old single switch across before it is dropped in 0013. A project
-- that excluded the weekend must keep excluding both days: defaulting to true
-- would hand every five-day project two working days it never agreed to.
UPDATE "projects"
   SET "count_saturday" = "count_weekends",
       "count_sunday" = "count_weekends";

ALTER TABLE "yu_inventory"."inspections" ADD COLUMN "deadline_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "yu_inventory"."inspections"
SET "deadline_at" = "created_at" + interval '30 days'
WHERE "deadline_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "yu_inventory"."inspections" ALTER COLUMN "deadline_at" SET NOT NULL;

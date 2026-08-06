ALTER TYPE "yu_inventory"."photo_purpose" ADD VALUE 'service_request' BEFORE 'inspection_result';--> statement-breakpoint
ALTER TABLE "yu_inventory"."photos" DROP CONSTRAINT "photos_parent_check";--> statement-breakpoint
ALTER TABLE "yu_inventory"."photos" ADD CONSTRAINT "photos_parent_check" CHECK ((
            "yu_inventory"."photos"."status" IN ('reserved', 'expired')
            AND "yu_inventory"."photos"."item_id" IS NULL
            AND "yu_inventory"."photos"."result_id" IS NULL
            AND "yu_inventory"."photos"."result_revision_number" IS NULL
            AND "yu_inventory"."photos"."decision_id" IS NULL
          ) OR (
            "yu_inventory"."photos"."status" NOT IN ('reserved', 'expired')
            AND (
              (
                  "yu_inventory"."photos"."purpose" IN ('item', 'service_request')
                AND "yu_inventory"."photos"."item_id" IS NOT NULL
                AND "yu_inventory"."photos"."result_id" IS NULL
                AND "yu_inventory"."photos"."result_revision_number" IS NULL
                AND "yu_inventory"."photos"."decision_id" IS NULL
              ) OR (
                "yu_inventory"."photos"."purpose" = 'inspection_result'
                AND "yu_inventory"."photos"."item_id" IS NULL
                AND "yu_inventory"."photos"."result_id" IS NOT NULL
                AND "yu_inventory"."photos"."result_revision_number" IS NOT NULL
                AND "yu_inventory"."photos"."decision_id" IS NULL
              ) OR (
                "yu_inventory"."photos"."purpose" = 'decision_dispute'
                AND "yu_inventory"."photos"."item_id" IS NULL
                AND "yu_inventory"."photos"."result_id" IS NULL
                AND "yu_inventory"."photos"."result_revision_number" IS NULL
                AND "yu_inventory"."photos"."decision_id" IS NOT NULL
              )
            )
          ));
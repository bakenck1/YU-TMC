ALTER TYPE "yu_inventory"."item_status" ADD VALUE 'decommissioned_in_use';--> statement-breakpoint
ALTER TYPE "yu_inventory"."photo_purpose" ADD VALUE 'decommissioned_usage' BEFORE 'inspection_result';--> statement-breakpoint
ALTER TABLE "yu_inventory"."photos" DROP CONSTRAINT "photos_parent_check";--> statement-breakpoint
ALTER TABLE "yu_inventory"."items" ADD COLUMN "decommissioned_usage_reason" text;--> statement-breakpoint
ALTER TABLE "yu_inventory"."items" ADD COLUMN "decommissioned_usage_comment" text;--> statement-breakpoint
ALTER TABLE "yu_inventory"."items" ADD COLUMN "decommissioned_usage_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "yu_inventory"."items" ADD COLUMN "decommissioned_usage_started_by" uuid;--> statement-breakpoint
ALTER TABLE "yu_inventory"."items" ADD CONSTRAINT "items_decommissioned_usage_started_by_users_id_fk" FOREIGN KEY ("decommissioned_usage_started_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."items" ADD CONSTRAINT "items_decommissioned_usage_check" CHECK ((
        "yu_inventory"."items"."status"::text = 'decommissioned_in_use'
        AND "yu_inventory"."items"."archived_at" IS NOT NULL
        AND "yu_inventory"."items"."decommissioned_usage_reason" IS NOT NULL
        AND btrim("yu_inventory"."items"."decommissioned_usage_reason") <> ''
        AND "yu_inventory"."items"."decommissioned_usage_comment" IS NOT NULL
        AND btrim("yu_inventory"."items"."decommissioned_usage_comment") <> ''
        AND "yu_inventory"."items"."decommissioned_usage_started_at" IS NOT NULL
        AND "yu_inventory"."items"."decommissioned_usage_started_by" IS NOT NULL
      ) OR (
        "yu_inventory"."items"."status"::text <> 'decommissioned_in_use'
        AND "yu_inventory"."items"."decommissioned_usage_reason" IS NULL
        AND "yu_inventory"."items"."decommissioned_usage_comment" IS NULL
        AND "yu_inventory"."items"."decommissioned_usage_started_at" IS NULL
        AND "yu_inventory"."items"."decommissioned_usage_started_by" IS NULL
      ));--> statement-breakpoint
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
                  "yu_inventory"."photos"."purpose"::text IN ('item', 'service_request', 'decommissioned_usage', 'asset_loss_receipt')
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
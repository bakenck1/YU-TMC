ALTER TABLE "yu_inventory"."items" DROP CONSTRAINT "items_decommissioned_usage_check";--> statement-breakpoint
ALTER TABLE "yu_inventory"."items" ADD CONSTRAINT "items_decommissioned_usage_check" CHECK ((
        "yu_inventory"."items"."status"::text = 'decommissioned_in_use'
        AND "yu_inventory"."items"."archived_at" IS NOT NULL
        AND ("yu_inventory"."items"."decommissioned_usage_reason" IS NULL OR btrim("yu_inventory"."items"."decommissioned_usage_reason") <> '')
        AND ("yu_inventory"."items"."decommissioned_usage_comment" IS NULL OR btrim("yu_inventory"."items"."decommissioned_usage_comment") <> '')
        AND "yu_inventory"."items"."decommissioned_usage_started_at" IS NOT NULL
        AND "yu_inventory"."items"."decommissioned_usage_started_by" IS NOT NULL
      ) OR (
        "yu_inventory"."items"."status"::text <> 'decommissioned_in_use'
        AND "yu_inventory"."items"."decommissioned_usage_reason" IS NULL
        AND "yu_inventory"."items"."decommissioned_usage_comment" IS NULL
        AND "yu_inventory"."items"."decommissioned_usage_started_at" IS NULL
        AND "yu_inventory"."items"."decommissioned_usage_started_by" IS NULL
      ));
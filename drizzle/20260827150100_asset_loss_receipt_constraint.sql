ALTER TABLE "yu_inventory"."photos"
  DROP CONSTRAINT "photos_parent_check";--> statement-breakpoint
ALTER TABLE "yu_inventory"."photos"
  ADD CONSTRAINT "photos_parent_check" CHECK (
    ("status" IN ('reserved', 'expired') AND "item_id" IS NULL AND "result_id" IS NULL AND "result_revision_number" IS NULL AND "decision_id" IS NULL)
    OR (
      "status" NOT IN ('reserved', 'expired') AND (
        ("purpose"::text IN ('item', 'service_request', 'asset_loss_receipt') AND "item_id" IS NOT NULL AND "result_id" IS NULL AND "result_revision_number" IS NULL AND "decision_id" IS NULL)
        OR ("purpose" = 'inspection_result' AND "item_id" IS NULL AND "result_id" IS NOT NULL AND "result_revision_number" IS NOT NULL AND "decision_id" IS NULL)
        OR ("purpose" = 'decision_dispute' AND "item_id" IS NULL AND "result_id" IS NULL AND "result_revision_number" IS NULL AND "decision_id" IS NOT NULL)
      )
    )
  );

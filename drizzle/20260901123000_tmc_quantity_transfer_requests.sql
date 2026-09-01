ALTER TABLE "yu_inventory"."tmc_transfer_request_items"
  ADD COLUMN "requested_quantity" integer,
  ADD COLUMN "source_local_group_id" uuid,
  ADD COLUMN "source_version" integer;--> statement-breakpoint
ALTER TABLE "yu_inventory"."tmc_transfer_request_items"
  ADD CONSTRAINT "tmc_transfer_request_items_source_local_group_id_local_item_groups_id_fk"
  FOREIGN KEY ("source_local_group_id") REFERENCES "yu_inventory"."local_item_groups"("id")
  ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."tmc_transfer_request_items"
  ADD CONSTRAINT "tmc_transfer_request_items_quantity_transfer_check"
  CHECK (
    ("requested_quantity" IS NULL AND "source_local_group_id" IS NULL AND "source_version" IS NULL)
    OR
    ("requested_quantity" > 0 AND "source_version" > 0)
  );

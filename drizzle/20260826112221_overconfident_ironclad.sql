ALTER TABLE "yu_inventory"."items" DROP CONSTRAINT "items_display_values_check";--> statement-breakpoint
UPDATE "yu_inventory"."items"
SET "name" = "item_type",
    "item_type" = CASE
      WHEN lower(btrim("item_type")) IN ('мебель', 'furniture') THEN 'furniture'
      ELSE 'electronics'
    END;--> statement-breakpoint
ALTER TABLE "yu_inventory"."deviation_decisions" DROP CONSTRAINT "deviation_decisions_result_revision_fk";
--> statement-breakpoint
ALTER TABLE "yu_inventory"."deviation_decisions" DROP CONSTRAINT "deviation_decisions_previous_result_fk";
--> statement-breakpoint
ALTER TABLE "yu_inventory"."deviation_decisions" DROP CONSTRAINT "deviation_decisions_recipient_kind_snapshot_fk";
--> statement-breakpoint
ALTER TABLE "yu_inventory"."deviation_decisions" DROP CONSTRAINT "deviation_decisions_recipient_user_snapshot_fk";
--> statement-breakpoint
ALTER TABLE "yu_inventory"."inspection_room_items" DROP CONSTRAINT "inspection_room_items_item_id_items_id_fk";
--> statement-breakpoint
ALTER TABLE "yu_inventory"."item_components" DROP CONSTRAINT "item_components_left_item_id_items_id_fk";
--> statement-breakpoint
ALTER TABLE "yu_inventory"."item_components" DROP CONSTRAINT "item_components_right_item_id_items_id_fk";
--> statement-breakpoint
ALTER TABLE "yu_inventory"."item_inventory_number_history" DROP CONSTRAINT "item_inventory_number_history_item_id_items_id_fk";
--> statement-breakpoint
ALTER TABLE "yu_inventory"."item_result_revisions" DROP CONSTRAINT "item_result_revisions_result_context_fk";
--> statement-breakpoint
ALTER TABLE "yu_inventory"."item_results" DROP CONSTRAINT "item_results_item_id_items_id_fk";
--> statement-breakpoint
ALTER TABLE "yu_inventory"."photos" DROP CONSTRAINT "photos_item_id_items_id_fk";
--> statement-breakpoint
ALTER TABLE "yu_inventory"."photos" DROP CONSTRAINT "photos_decision_id_deviation_decisions_id_fk";
--> statement-breakpoint
ALTER TABLE "yu_inventory"."photos" DROP CONSTRAINT "photos_result_revision_fk";
--> statement-breakpoint
ALTER TABLE "yu_inventory"."qr_identifiers" DROP CONSTRAINT "qr_identifiers_item_id_items_id_fk";
--> statement-breakpoint
ALTER TABLE "yu_inventory"."responsibility_periods" DROP CONSTRAINT "responsibility_periods_item_id_items_id_fk";
--> statement-breakpoint
ALTER TABLE "yu_inventory"."service_requests" DROP CONSTRAINT "service_requests_item_id_items_id_fk";
--> statement-breakpoint
ALTER TABLE "yu_inventory"."tmc_operation_notifications" DROP CONSTRAINT "tmc_operation_notifications_item_id_items_id_fk";
--> statement-breakpoint
ALTER TABLE "yu_inventory"."tmc_transfer_request_items" DROP CONSTRAINT "tmc_transfer_request_items_item_id_items_id_fk";
--> statement-breakpoint
ALTER TABLE "yu_inventory"."transfers" DROP CONSTRAINT "transfers_item_id_items_id_fk";
--> statement-breakpoint
ALTER TABLE "yu_inventory"."items" ALTER COLUMN "item_type" SET DEFAULT 'electronics';--> statement-breakpoint
ALTER TABLE "yu_inventory"."deviation_decisions" ADD CONSTRAINT "deviation_decisions_result_revision_fk" FOREIGN KEY ("result_id","result_revision_number") REFERENCES "yu_inventory"."item_result_revisions"("result_id","revision_number") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."deviation_decisions" ADD CONSTRAINT "deviation_decisions_previous_result_fk" FOREIGN KEY ("previous_decision_id","result_id") REFERENCES "yu_inventory"."deviation_decisions"("id","result_id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."deviation_decisions" ADD CONSTRAINT "deviation_decisions_recipient_kind_snapshot_fk" FOREIGN KEY ("result_id","recipient_kind") REFERENCES "yu_inventory"."item_results"("id","decision_recipient_kind_at_scan") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."deviation_decisions" ADD CONSTRAINT "deviation_decisions_recipient_user_snapshot_fk" FOREIGN KEY ("result_id","recipient_id") REFERENCES "yu_inventory"."item_results"("id","responsible_id_at_scan") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."inspection_room_items" ADD CONSTRAINT "inspection_room_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."item_components" ADD CONSTRAINT "item_components_left_item_id_items_id_fk" FOREIGN KEY ("left_item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."item_components" ADD CONSTRAINT "item_components_right_item_id_items_id_fk" FOREIGN KEY ("right_item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."item_inventory_number_history" ADD CONSTRAINT "item_inventory_number_history_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."item_result_revisions" ADD CONSTRAINT "item_result_revisions_result_context_fk" FOREIGN KEY ("result_id","inspection_room_id") REFERENCES "yu_inventory"."item_results"("id","inspection_room_id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."item_results" ADD CONSTRAINT "item_results_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."photos" ADD CONSTRAINT "photos_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."photos" ADD CONSTRAINT "photos_decision_id_deviation_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "yu_inventory"."deviation_decisions"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."photos" ADD CONSTRAINT "photos_result_revision_fk" FOREIGN KEY ("result_id","result_revision_number") REFERENCES "yu_inventory"."item_result_revisions"("result_id","revision_number") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."qr_identifiers" ADD CONSTRAINT "qr_identifiers_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."responsibility_periods" ADD CONSTRAINT "responsibility_periods_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."service_requests" ADD CONSTRAINT "service_requests_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."tmc_operation_notifications" ADD CONSTRAINT "tmc_operation_notifications_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."tmc_transfer_request_items" ADD CONSTRAINT "tmc_transfer_request_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."transfers" ADD CONSTRAINT "transfers_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."items" ADD CONSTRAINT "items_display_values_check" CHECK (btrim("yu_inventory"."items"."name") <> ''
          AND ("yu_inventory"."items"."description" IS NULL OR btrim("yu_inventory"."items"."description") <> '')
          AND "yu_inventory"."items"."item_type" in ('electronics', 'furniture')
          AND btrim("yu_inventory"."items"."inventory_number") <> ''
          AND btrim("yu_inventory"."items"."inventory_number_key") <> ''
          AND "yu_inventory"."items"."quantity" > 0
          AND "yu_inventory"."items"."unit_price" >= 0);

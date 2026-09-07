ALTER TABLE "yu_inventory"."items" DROP CONSTRAINT "items_display_values_check";--> statement-breakpoint
ALTER TABLE "yu_inventory"."items" ADD CONSTRAINT "items_display_values_check" CHECK (btrim("yu_inventory"."items"."name") <> ''
          AND ("yu_inventory"."items"."description" IS NULL OR btrim("yu_inventory"."items"."description") <> '')
          AND "yu_inventory"."items"."item_type" in ('electronics', 'electrical_equipment', 'furniture')
          AND btrim("yu_inventory"."items"."inventory_number") <> ''
          AND btrim("yu_inventory"."items"."inventory_number_key") <> ''
          AND "yu_inventory"."items"."quantity" > 0
          AND "yu_inventory"."items"."unit_price" >= 0);

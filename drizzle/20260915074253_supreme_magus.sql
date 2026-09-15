CREATE TYPE "yu_inventory"."inventory_section" AS ENUM('general', 'it');--> statement-breakpoint
CREATE TYPE "yu_inventory"."it_equipment_type" AS ENUM('wifi_access_point', 'camera');--> statement-breakpoint
CREATE TABLE "yu_inventory"."item_network_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"device_label" text,
	"ip_address" text,
	"mac_address" text,
	CONSTRAINT "item_network_addresses_position_check" CHECK ("yu_inventory"."item_network_addresses"."position" >= 0),
	CONSTRAINT "item_network_addresses_nonempty_check" CHECK (coalesce(btrim("yu_inventory"."item_network_addresses"."device_label"), '') <> ''
          OR coalesce(btrim("yu_inventory"."item_network_addresses"."ip_address"), '') <> ''
          OR coalesce(btrim("yu_inventory"."item_network_addresses"."mac_address"), '') <> '')
);
--> statement-breakpoint
ALTER TABLE "yu_inventory"."items" DROP CONSTRAINT "items_display_values_check";--> statement-breakpoint
ALTER TABLE "yu_inventory"."items" ADD COLUMN "item_section" "yu_inventory"."inventory_section" DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "yu_inventory"."items" ADD COLUMN "it_type" "yu_inventory"."it_equipment_type";--> statement-breakpoint
ALTER TABLE "yu_inventory"."item_network_addresses" ADD CONSTRAINT "item_network_addresses_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "item_network_addresses_item_position_unique" ON "yu_inventory"."item_network_addresses" USING btree ("item_id","position");--> statement-breakpoint
CREATE INDEX "item_network_addresses_item_idx" ON "yu_inventory"."item_network_addresses" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "items_section_status_idx" ON "yu_inventory"."items" USING btree ("item_section","status");--> statement-breakpoint
ALTER TABLE "yu_inventory"."items" ADD CONSTRAINT "items_display_values_check" CHECK (btrim("yu_inventory"."items"."name") <> ''
          AND ("yu_inventory"."items"."description" IS NULL OR btrim("yu_inventory"."items"."description") <> '')
          AND (
            ("yu_inventory"."items"."item_section" = 'general' AND "yu_inventory"."items"."item_type" in ('electronics', 'electrical_equipment', 'furniture') AND "yu_inventory"."items"."it_type" IS NULL)
            OR
            ("yu_inventory"."items"."item_section" = 'it' AND "yu_inventory"."items"."it_type" in ('wifi_access_point', 'camera') AND "yu_inventory"."items"."item_type" = "yu_inventory"."items"."it_type"::text)
          )
          AND btrim("yu_inventory"."items"."inventory_number") <> ''
          AND btrim("yu_inventory"."items"."inventory_number_key") <> ''
          AND "yu_inventory"."items"."quantity" > 0
          AND "yu_inventory"."items"."unit_price" >= 0);

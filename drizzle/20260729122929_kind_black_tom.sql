ALTER TABLE "yu_inventory"."items" DROP CONSTRAINT "items_display_values_check";--> statement-breakpoint
ALTER TABLE "yu_inventory"."items" ADD COLUMN "item_type" varchar(120) DEFAULT 'ТМЦ' NOT NULL;--> statement-breakpoint
ALTER TABLE "yu_inventory"."items" ADD COLUMN "brand" varchar(120);--> statement-breakpoint
ALTER TABLE "yu_inventory"."items" ADD COLUMN "model" varchar(160);--> statement-breakpoint
ALTER TABLE "yu_inventory"."items" ADD COLUMN "quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "yu_inventory"."items" ADD COLUMN "unit_price" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "yu_inventory"."items" ADD CONSTRAINT "items_display_values_check" CHECK (btrim("yu_inventory"."items"."name") <> ''
          AND ("yu_inventory"."items"."description" IS NULL OR btrim("yu_inventory"."items"."description") <> '')
          AND btrim("yu_inventory"."items"."item_type") <> ''
          AND btrim("yu_inventory"."items"."inventory_number") <> ''
          AND btrim("yu_inventory"."items"."inventory_number_key") <> ''
          AND "yu_inventory"."items"."quantity" > 0
          AND "yu_inventory"."items"."unit_price" >= 0);
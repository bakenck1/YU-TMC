ALTER TABLE "yu_inventory"."one_c_material_inbox" DROP CONSTRAINT "one_c_material_inbox_identity_unique";--> statement-breakpoint
ALTER TABLE "yu_inventory"."one_c_material_inbox" ADD COLUMN "identity_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "yu_inventory"."one_c_material_inbox" ADD COLUMN "account_key" text DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
ALTER TABLE "yu_inventory"."one_c_material_inbox" ADD COLUMN "responsible_key" text DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
ALTER TABLE "yu_inventory"."one_c_material_inbox" ADD COLUMN "responsible_code" text;--> statement-breakpoint
ALTER TABLE "yu_inventory"."one_c_material_inbox" ADD COLUMN "responsible_external_id" uuid;--> statement-breakpoint
ALTER TABLE "yu_inventory"."one_c_material_inbox" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "one_c_material_inbox_responsible_guid_idx" ON "yu_inventory"."one_c_material_inbox" USING btree ("responsible_external_id");--> statement-breakpoint
CREATE INDEX "one_c_material_inbox_current_idx" ON "yu_inventory"."one_c_material_inbox" USING btree ("identity_version","superseded_at");--> statement-breakpoint
ALTER TABLE "yu_inventory"."one_c_material_inbox" ADD CONSTRAINT "one_c_material_inbox_identity_unique" UNIQUE("material_code","warehouse_key","identity_version","account_key","responsible_key");--> statement-breakpoint
ALTER TABLE "yu_inventory"."one_c_material_inbox" ADD CONSTRAINT "one_c_material_inbox_dimensions_check" CHECK (("yu_inventory"."one_c_material_inbox"."identity_version" = 1 AND "yu_inventory"."one_c_material_inbox"."account_key" = 'unspecified' AND "yu_inventory"."one_c_material_inbox"."responsible_key" = 'unspecified') OR ("yu_inventory"."one_c_material_inbox"."identity_version" = 2 AND "yu_inventory"."one_c_material_inbox"."account_key" <> 'unspecified' AND length(trim("yu_inventory"."one_c_material_inbox"."account_key")) > 0));
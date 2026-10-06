ALTER TABLE "yu_inventory"."one_c_import_batch_rows" DROP CONSTRAINT "one_c_import_batch_rows_publication_check";--> statement-breakpoint
ALTER TABLE "yu_inventory"."item_one_c_links" DROP CONSTRAINT "item_one_c_links_item_id_items_id_fk";
--> statement-breakpoint
ALTER TABLE "yu_inventory"."one_c_import_batch_rows" DROP CONSTRAINT "one_c_import_batch_rows_matched_item_id_items_id_fk";
--> statement-breakpoint
ALTER TABLE "yu_inventory"."one_c_import_batch_rows" DROP CONSTRAINT "one_c_import_batch_rows_published_item_id_items_id_fk";
--> statement-breakpoint
ALTER TABLE "yu_inventory"."item_one_c_links" ADD CONSTRAINT "item_one_c_links_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."one_c_import_batch_rows" ADD CONSTRAINT "one_c_import_batch_rows_matched_item_id_items_id_fk" FOREIGN KEY ("matched_item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."one_c_import_batch_rows" ADD CONSTRAINT "one_c_import_batch_rows_published_item_id_items_id_fk" FOREIGN KEY ("published_item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE set null ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "one_c_import_batch_rows_published_item_idx" ON "yu_inventory"."one_c_import_batch_rows" USING btree ("published_item_id");--> statement-breakpoint
ALTER TABLE "yu_inventory"."one_c_import_batch_rows" ADD CONSTRAINT "one_c_import_batch_rows_publication_check" CHECK ("yu_inventory"."one_c_import_batch_rows"."published_item_id" IS NULL OR "yu_inventory"."one_c_import_batch_rows"."published_at" IS NOT NULL);
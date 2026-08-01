CREATE TABLE "yu_inventory"."item_components" (
	"left_item_id" uuid NOT NULL,
	"right_item_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_components_left_item_id_right_item_id_pk" PRIMARY KEY("left_item_id","right_item_id"),
	CONSTRAINT "item_components_canonical_order_check" CHECK ("yu_inventory"."item_components"."left_item_id" < "yu_inventory"."item_components"."right_item_id")
);
--> statement-breakpoint
ALTER TABLE "yu_inventory"."item_components" ADD CONSTRAINT "item_components_left_item_id_items_id_fk" FOREIGN KEY ("left_item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."item_components" ADD CONSTRAINT "item_components_right_item_id_items_id_fk" FOREIGN KEY ("right_item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."item_components" ADD CONSTRAINT "item_components_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "item_components_right_item_idx" ON "yu_inventory"."item_components" USING btree ("right_item_id");--> statement-breakpoint
CREATE INDEX "item_components_created_by_idx" ON "yu_inventory"."item_components" USING btree ("created_by");
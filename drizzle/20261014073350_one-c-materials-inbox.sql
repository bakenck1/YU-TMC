CREATE TABLE "yu_inventory"."one_c_material_import_batch_rows" (
	"batch_id" uuid NOT NULL,
	"row_key" text NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "one_c_material_batch_rows_pk" PRIMARY KEY("batch_id","row_key"),
	CONSTRAINT "one_c_material_batch_rows_hash_check" CHECK ("yu_inventory"."one_c_material_import_batch_rows"."payload_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "yu_inventory"."one_c_material_import_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"source_filename" text,
	"source_sha256" varchar(64) NOT NULL,
	"source_snapshot_at" timestamp with time zone NOT NULL,
	"received_count" integer NOT NULL,
	"created_count" integer NOT NULL,
	"updated_count" integer NOT NULL,
	"unchanged_count" integer NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "one_c_material_import_batches_sourceSha256_unique" UNIQUE("source_sha256"),
	CONSTRAINT "one_c_material_batches_hash_check" CHECK ("yu_inventory"."one_c_material_import_batches"."source_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "one_c_material_batches_counts_check" CHECK ("yu_inventory"."one_c_material_import_batches"."received_count" >= 0 AND "yu_inventory"."one_c_material_import_batches"."created_count" >= 0 AND "yu_inventory"."one_c_material_import_batches"."updated_count" >= 0 AND "yu_inventory"."one_c_material_import_batches"."unchanged_count" >= 0 AND "yu_inventory"."one_c_material_import_batches"."created_count" + "yu_inventory"."one_c_material_import_batches"."updated_count" + "yu_inventory"."one_c_material_import_batches"."unchanged_count" = "yu_inventory"."one_c_material_import_batches"."received_count")
);
--> statement-breakpoint
CREATE TABLE "yu_inventory"."one_c_material_inbox" (
	"row_key" text PRIMARY KEY NOT NULL,
	"material_code" text NOT NULL,
	"warehouse_key" text NOT NULL,
	"material_external_id" uuid,
	"warehouse_external_id" uuid,
	"payload_hash" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"quantity" numeric(18, 3) NOT NULL,
	"unit_price" numeric(18, 2),
	"source_snapshot_at" timestamp with time zone NOT NULL,
	"last_batch_id" uuid NOT NULL,
	"last_request_id" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "one_c_material_inbox_identity_unique" UNIQUE("material_code","warehouse_key"),
	CONSTRAINT "one_c_material_inbox_hash_check" CHECK ("yu_inventory"."one_c_material_inbox"."payload_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "one_c_material_inbox_price_check" CHECK ("yu_inventory"."one_c_material_inbox"."unit_price" IS NULL OR "yu_inventory"."one_c_material_inbox"."unit_price" >= 0),
	CONSTRAINT "one_c_material_inbox_code_check" CHECK (length(trim("yu_inventory"."one_c_material_inbox"."material_code")) > 0)
);
--> statement-breakpoint
ALTER TABLE "yu_inventory"."one_c_material_import_batch_rows" ADD CONSTRAINT "one_c_material_import_batch_rows_batch_id_one_c_material_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "yu_inventory"."one_c_material_import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yu_inventory"."one_c_material_inbox" ADD CONSTRAINT "one_c_material_inbox_last_batch_id_one_c_material_import_batches_id_fk" FOREIGN KEY ("last_batch_id") REFERENCES "yu_inventory"."one_c_material_import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "one_c_material_batch_rows_identity_idx" ON "yu_inventory"."one_c_material_import_batch_rows" USING btree ("row_key");--> statement-breakpoint
CREATE INDEX "one_c_material_batches_received_idx" ON "yu_inventory"."one_c_material_import_batches" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "one_c_material_inbox_snapshot_idx" ON "yu_inventory"."one_c_material_inbox" USING btree ("source_snapshot_at");--> statement-breakpoint
CREATE INDEX "one_c_material_inbox_material_guid_idx" ON "yu_inventory"."one_c_material_inbox" USING btree ("material_external_id");--> statement-breakpoint
CREATE INDEX "one_c_material_inbox_warehouse_guid_idx" ON "yu_inventory"."one_c_material_inbox" USING btree ("warehouse_external_id");
--> statement-breakpoint
CREATE FUNCTION "yu_inventory"."protect_one_c_material_source"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'immutable 1C material source snapshot';
END $$;
--> statement-breakpoint
CREATE TRIGGER "protect_one_c_material_batch_source"
  BEFORE UPDATE OR DELETE ON "yu_inventory"."one_c_material_import_batches"
  FOR EACH ROW EXECUTE FUNCTION "yu_inventory"."protect_one_c_material_source"();
--> statement-breakpoint
CREATE TRIGGER "protect_one_c_material_row_source"
  BEFORE UPDATE OR DELETE ON "yu_inventory"."one_c_material_import_batch_rows"
  FOR EACH ROW EXECUTE FUNCTION "yu_inventory"."protect_one_c_material_source"();

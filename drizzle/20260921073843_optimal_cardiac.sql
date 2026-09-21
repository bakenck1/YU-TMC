CREATE TABLE "yu_inventory"."item_one_c_links" (
	"external_id" text PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"source_code" text,
	"source_inventory_number" text,
	"linked_by" uuid NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"link_method" varchar(32) NOT NULL,
	"last_batch_id" uuid NOT NULL,
	"last_payload_hash" varchar(64) NOT NULL,
	"accounting_status" text,
	"accounting_residual_value" numeric(14, 2),
	"source_department" text,
	"source_responsible_name" text,
	"source_updated_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "item_one_c_links_itemId_unique" UNIQUE("item_id"),
	CONSTRAINT "item_one_c_links_method_check" CHECK ("yu_inventory"."item_one_c_links"."link_method" in ('manual','inventory_number_confirmed','created_from_one_c')),
	CONSTRAINT "item_one_c_links_hash_check" CHECK ("yu_inventory"."item_one_c_links"."last_payload_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "item_one_c_links_version_check" CHECK ("yu_inventory"."item_one_c_links"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "yu_inventory"."one_c_import_batch_rows" (
	"batch_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"review_state" varchar(24) DEFAULT 'pending' NOT NULL,
	"proposed_action" varchar(24) DEFAULT 'manual_review' NOT NULL,
	"matched_item_id" uuid,
	"match_method" varchar(48),
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decision" jsonb,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"published_item_id" uuid,
	"published_at" timestamp with time zone,
	CONSTRAINT "one_c_import_batch_rows_pk" PRIMARY KEY("batch_id","external_id"),
	CONSTRAINT "one_c_import_batch_rows_hash_check" CHECK ("yu_inventory"."one_c_import_batch_rows"."payload_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "one_c_import_batch_rows_review_state_check" CHECK ("yu_inventory"."one_c_import_batch_rows"."review_state" in ('pending','ready','matched','conflict','blocked','excluded','approved','published','failed')),
	CONSTRAINT "one_c_import_batch_rows_action_check" CHECK ("yu_inventory"."one_c_import_batch_rows"."proposed_action" in ('create','link','update','exclude','manual_review','no_change')),
	CONSTRAINT "one_c_import_batch_rows_decision_actor_check" CHECK (("yu_inventory"."one_c_import_batch_rows"."decision" IS NULL) = ("yu_inventory"."one_c_import_batch_rows"."decided_by" IS NULL) AND ("yu_inventory"."one_c_import_batch_rows"."decision" IS NULL) = ("yu_inventory"."one_c_import_batch_rows"."decided_at" IS NULL)),
	CONSTRAINT "one_c_import_batch_rows_publication_check" CHECK (("yu_inventory"."one_c_import_batch_rows"."published_item_id" IS NULL) = ("yu_inventory"."one_c_import_batch_rows"."published_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "yu_inventory"."one_c_import_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid,
	"source_filename" text,
	"source_sha256" varchar(64) NOT NULL,
	"source_snapshot_at" timestamp with time zone,
	"received_count" integer NOT NULL,
	"created_count" integer NOT NULL,
	"updated_count" integer NOT NULL,
	"unchanged_count" integer NOT NULL,
	"state" varchar(32) DEFAULT 'received' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"review_started_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "one_c_import_batches_source_sha256_unique" UNIQUE("source_sha256"),
	CONSTRAINT "one_c_import_batches_hash_check" CHECK ("yu_inventory"."one_c_import_batches"."source_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "one_c_import_batches_counts_check" CHECK ("yu_inventory"."one_c_import_batches"."received_count" >= 0 AND "yu_inventory"."one_c_import_batches"."created_count" >= 0 AND "yu_inventory"."one_c_import_batches"."updated_count" >= 0 AND "yu_inventory"."one_c_import_batches"."unchanged_count" >= 0 AND "yu_inventory"."one_c_import_batches"."created_count" + "yu_inventory"."one_c_import_batches"."updated_count" + "yu_inventory"."one_c_import_batches"."unchanged_count" = "yu_inventory"."one_c_import_batches"."received_count"),
	CONSTRAINT "one_c_import_batches_state_check" CHECK ("yu_inventory"."one_c_import_batches"."state" in ('received','analyzing','review_required','approved','publishing','published','failed','rejected','superseded')),
	CONSTRAINT "one_c_import_batches_version_check" CHECK ("yu_inventory"."one_c_import_batches"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "yu_inventory"."one_c_publication_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"state" varchar(24) NOT NULL,
	"requested_by" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_items" integer DEFAULT 0 NOT NULL,
	"linked_items" integer DEFAULT 0 NOT NULL,
	"updated_items" integer DEFAULT 0 NOT NULL,
	"skipped_items" integer DEFAULT 0 NOT NULL,
	"failed_items" integer DEFAULT 0 NOT NULL,
	"error_summary" jsonb,
	CONSTRAINT "one_c_publication_runs_idempotencyKey_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "one_c_publication_runs_state_check" CHECK ("yu_inventory"."one_c_publication_runs"."state" in ('pending','running','completed','failed')),
	CONSTRAINT "one_c_publication_runs_counts_check" CHECK ("yu_inventory"."one_c_publication_runs"."created_items" >= 0 AND "yu_inventory"."one_c_publication_runs"."linked_items" >= 0 AND "yu_inventory"."one_c_publication_runs"."updated_items" >= 0 AND "yu_inventory"."one_c_publication_runs"."skipped_items" >= 0 AND "yu_inventory"."one_c_publication_runs"."failed_items" >= 0)
);
--> statement-breakpoint
ALTER TABLE "yu_inventory"."one_c_fixed_asset_inbox" ADD COLUMN "last_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "yu_inventory"."one_c_fixed_asset_inbox" ADD COLUMN "last_request_id" uuid;--> statement-breakpoint
ALTER TABLE "yu_inventory"."one_c_fixed_asset_inbox" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "yu_inventory"."item_one_c_links" ADD CONSTRAINT "item_one_c_links_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."item_one_c_links" ADD CONSTRAINT "item_one_c_links_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."item_one_c_links" ADD CONSTRAINT "item_one_c_links_last_batch_id_one_c_import_batches_id_fk" FOREIGN KEY ("last_batch_id") REFERENCES "yu_inventory"."one_c_import_batches"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."one_c_import_batch_rows" ADD CONSTRAINT "one_c_import_batch_rows_batch_id_one_c_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "yu_inventory"."one_c_import_batches"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."one_c_import_batch_rows" ADD CONSTRAINT "one_c_import_batch_rows_matched_item_id_items_id_fk" FOREIGN KEY ("matched_item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."one_c_import_batch_rows" ADD CONSTRAINT "one_c_import_batch_rows_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."one_c_import_batch_rows" ADD CONSTRAINT "one_c_import_batch_rows_published_item_id_items_id_fk" FOREIGN KEY ("published_item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."one_c_import_batches" ADD CONSTRAINT "one_c_import_batches_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."one_c_import_batches" ADD CONSTRAINT "one_c_import_batches_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."one_c_publication_runs" ADD CONSTRAINT "one_c_publication_runs_batch_id_one_c_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "yu_inventory"."one_c_import_batches"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."one_c_publication_runs" ADD CONSTRAINT "one_c_publication_runs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "item_one_c_links_last_batch_idx" ON "yu_inventory"."item_one_c_links" USING btree ("last_batch_id");--> statement-breakpoint
CREATE INDEX "one_c_import_batch_rows_batch_state_action_idx" ON "yu_inventory"."one_c_import_batch_rows" USING btree ("batch_id","review_state","proposed_action");--> statement-breakpoint
CREATE INDEX "one_c_import_batch_rows_external_idx" ON "yu_inventory"."one_c_import_batch_rows" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "one_c_import_batch_rows_matched_item_idx" ON "yu_inventory"."one_c_import_batch_rows" USING btree ("matched_item_id");--> statement-breakpoint
CREATE INDEX "one_c_import_batches_state_received_idx" ON "yu_inventory"."one_c_import_batches" USING btree ("state","received_at");--> statement-breakpoint
CREATE INDEX "one_c_publication_runs_batch_state_idx" ON "yu_inventory"."one_c_publication_runs" USING btree ("batch_id","state");--> statement-breakpoint
ALTER TABLE "yu_inventory"."one_c_fixed_asset_inbox" ADD CONSTRAINT "one_c_fixed_asset_inbox_last_batch_fk" FOREIGN KEY ("last_batch_id") REFERENCES "yu_inventory"."one_c_import_batches"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "yu_inventory"."protect_one_c_batch_source"() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.batch_id IS DISTINCT FROM NEW.batch_id OR OLD.external_id IS DISTINCT FROM NEW.external_id OR OLD.payload_hash IS DISTINCT FROM NEW.payload_hash OR OLD.payload IS DISTINCT FROM NEW.payload THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'immutable 1C batch source fields';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "protect_one_c_batch_source" BEFORE UPDATE ON "yu_inventory"."one_c_import_batch_rows" FOR EACH ROW EXECUTE FUNCTION "yu_inventory"."protect_one_c_batch_source"();

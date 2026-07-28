DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "yu_inventory"."items"
    GROUP BY "inventory_number_key" HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM "yu_inventory"."qr_identifiers"
    GROUP BY "canonical_key" HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM "yu_inventory"."responsibility_periods"
    WHERE "ended_at" IS NULL GROUP BY "item_id" HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM "yu_inventory"."transfers"
    WHERE "status" = 'pending_current_owner' GROUP BY "item_id" HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM "yu_inventory"."item_results"
    GROUP BY "inspection_id", "item_id" HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM "yu_inventory"."deviation_decisions"
    WHERE "status" = 'pending' GROUP BY "result_id" HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM "yu_inventory"."item_inventory_number_history"
    GROUP BY "comparison_key" HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM "yu_inventory"."item_inventory_number_history"
    WHERE "replaced_at" IS NULL GROUP BY "item_id" HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM "yu_inventory"."qr_identifiers"
    WHERE "status" = 'active' AND "role" = 'primary' AND "building_id" IS NOT NULL
    GROUP BY "building_id" HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM "yu_inventory"."qr_identifiers"
    WHERE "status" = 'active' AND "role" = 'primary' AND "room_id" IS NOT NULL
    GROUP BY "room_id" HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM "yu_inventory"."qr_identifiers"
    WHERE "status" = 'active' AND "role" = 'primary' AND "item_id" IS NOT NULL
    GROUP BY "item_id" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'Cannot add inventory concurrency constraints while legacy duplicates exist',
      HINT = 'Deduplicate the affected inventory records before applying this release.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "yu_inventory"."deviation_decisions"
    WHERE "status" = 'resolved_by_admin'
      AND ("administrative_reason" IS NULL OR btrim("administrative_reason") = '')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Cannot require an administrative reason while legacy decisions have none',
      HINT = 'Classify each resolved_by_admin decision and record its administrative reason before applying this release.';
  END IF;
END;
$$;--> statement-breakpoint
CREATE TYPE "yu_inventory"."idempotency_state" AS ENUM('processing', 'completed');--> statement-breakpoint
CREATE TABLE "yu_inventory"."idempotency_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"operation" varchar(80) NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"state" "yu_inventory"."idempotency_state" DEFAULT 'processing' NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"resource_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_requests_values_check" CHECK (btrim("yu_inventory"."idempotency_requests"."operation") <> ''
          AND btrim("yu_inventory"."idempotency_requests"."idempotency_key") <> ''
          AND "yu_inventory"."idempotency_requests"."request_hash" ~ '^[0-9a-f]{64}$'
          AND "yu_inventory"."idempotency_requests"."expires_at" > "yu_inventory"."idempotency_requests"."created_at"),
	CONSTRAINT "idempotency_requests_state_check" CHECK ((
            "yu_inventory"."idempotency_requests"."state" = 'processing'
            AND "yu_inventory"."idempotency_requests"."response_status" IS NULL
            AND "yu_inventory"."idempotency_requests"."response_body" IS NULL
            AND "yu_inventory"."idempotency_requests"."completed_at" IS NULL
          ) OR (
            "yu_inventory"."idempotency_requests"."state" = 'completed'
            AND "yu_inventory"."idempotency_requests"."response_status" BETWEEN 100 AND 599
            AND "yu_inventory"."idempotency_requests"."response_body" IS NOT NULL
            AND "yu_inventory"."idempotency_requests"."completed_at" IS NOT NULL
            AND "yu_inventory"."idempotency_requests"."completed_at" >= "yu_inventory"."idempotency_requests"."created_at"
          ))
);
--> statement-breakpoint
ALTER TABLE "yu_inventory"."audit_records" DROP CONSTRAINT "audit_records_reason_check";--> statement-breakpoint
ALTER TABLE "yu_inventory"."deviation_decisions" DROP CONSTRAINT "deviation_decisions_administrative_reason_scope_check";--> statement-breakpoint
DROP INDEX "yu_inventory"."qr_identifiers_canonical_key_idx";--> statement-breakpoint
ALTER TABLE "yu_inventory"."audit_records" ADD COLUMN "is_administrative_exception" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "yu_inventory"."buildings" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "yu_inventory"."deviation_decisions" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "yu_inventory"."inspections" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "yu_inventory"."items" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "yu_inventory"."photos" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "yu_inventory"."qr_identifiers" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "yu_inventory"."rooms" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "yu_inventory"."transfers" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "yu_inventory"."idempotency_requests" ADD CONSTRAINT "idempotency_requests_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_requests_actor_operation_key_unique" ON "yu_inventory"."idempotency_requests" USING btree ("actor_id","operation","idempotency_key");--> statement-breakpoint
CREATE INDEX "idempotency_requests_expiry_idx" ON "yu_inventory"."idempotency_requests" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deviation_decisions_pending_result_unique" ON "yu_inventory"."deviation_decisions" USING btree ("result_id") WHERE "yu_inventory"."deviation_decisions"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "item_inventory_number_history_key_unique" ON "yu_inventory"."item_inventory_number_history" USING btree ("comparison_key");--> statement-breakpoint
CREATE UNIQUE INDEX "item_inventory_number_history_open_item_unique" ON "yu_inventory"."item_inventory_number_history" USING btree ("item_id") WHERE "yu_inventory"."item_inventory_number_history"."replaced_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "item_results_inspection_item_unique" ON "yu_inventory"."item_results" USING btree ("inspection_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "items_inventory_number_key_unique" ON "yu_inventory"."items" USING btree ("inventory_number_key");--> statement-breakpoint
CREATE UNIQUE INDEX "qr_identifiers_canonical_key_unique" ON "yu_inventory"."qr_identifiers" USING btree ("canonical_key");--> statement-breakpoint
CREATE UNIQUE INDEX "qr_identifiers_active_primary_building_unique" ON "yu_inventory"."qr_identifiers" USING btree ("building_id") WHERE "yu_inventory"."qr_identifiers"."status" = 'active' AND "yu_inventory"."qr_identifiers"."role" = 'primary' AND "yu_inventory"."qr_identifiers"."building_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "qr_identifiers_active_primary_room_unique" ON "yu_inventory"."qr_identifiers" USING btree ("room_id") WHERE "yu_inventory"."qr_identifiers"."status" = 'active' AND "yu_inventory"."qr_identifiers"."role" = 'primary' AND "yu_inventory"."qr_identifiers"."room_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "qr_identifiers_active_primary_item_unique" ON "yu_inventory"."qr_identifiers" USING btree ("item_id") WHERE "yu_inventory"."qr_identifiers"."status" = 'active' AND "yu_inventory"."qr_identifiers"."role" = 'primary' AND "yu_inventory"."qr_identifiers"."item_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "responsibility_periods_open_item_unique" ON "yu_inventory"."responsibility_periods" USING btree ("item_id") WHERE "yu_inventory"."responsibility_periods"."ended_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "transfers_pending_item_unique" ON "yu_inventory"."transfers" USING btree ("item_id") WHERE "yu_inventory"."transfers"."status" = 'pending_current_owner';--> statement-breakpoint
ALTER TABLE "yu_inventory"."audit_records" ADD CONSTRAINT "audit_records_reason_check" CHECK ((
            "yu_inventory"."audit_records"."reason" IS NULL
            AND "yu_inventory"."audit_records"."is_administrative_exception" = false
          ) OR (
            "yu_inventory"."audit_records"."reason" IS NOT NULL
            AND btrim("yu_inventory"."audit_records"."reason") <> ''
          ));--> statement-breakpoint
ALTER TABLE "yu_inventory"."buildings" ADD CONSTRAINT "buildings_version_check" CHECK ("yu_inventory"."buildings"."version" > 0);--> statement-breakpoint
ALTER TABLE "yu_inventory"."deviation_decisions" ADD CONSTRAINT "deviation_decisions_version_check" CHECK ("yu_inventory"."deviation_decisions"."version" > 0);--> statement-breakpoint
ALTER TABLE "yu_inventory"."deviation_decisions" ADD CONSTRAINT "deviation_decisions_administrative_reason_scope_check" CHECK ((
            "yu_inventory"."deviation_decisions"."status" = 'resolved_by_admin'
            AND "yu_inventory"."deviation_decisions"."administrative_reason" IS NOT NULL
            AND btrim("yu_inventory"."deviation_decisions"."administrative_reason") <> ''
          ) OR (
            "yu_inventory"."deviation_decisions"."status" <> 'resolved_by_admin'
            AND "yu_inventory"."deviation_decisions"."administrative_reason" IS NULL
          ));--> statement-breakpoint
ALTER TABLE "yu_inventory"."inspections" ADD CONSTRAINT "inspections_version_check" CHECK ("yu_inventory"."inspections"."version" > 0);--> statement-breakpoint
ALTER TABLE "yu_inventory"."items" ADD CONSTRAINT "items_version_check" CHECK ("yu_inventory"."items"."version" > 0);--> statement-breakpoint
ALTER TABLE "yu_inventory"."photos" ADD CONSTRAINT "photos_version_check" CHECK ("yu_inventory"."photos"."version" > 0);--> statement-breakpoint
ALTER TABLE "yu_inventory"."qr_identifiers" ADD CONSTRAINT "qr_identifiers_version_check" CHECK ("yu_inventory"."qr_identifiers"."version" > 0);--> statement-breakpoint
ALTER TABLE "yu_inventory"."rooms" ADD CONSTRAINT "rooms_version_check" CHECK ("yu_inventory"."rooms"."version" > 0);--> statement-breakpoint
ALTER TABLE "yu_inventory"."transfers" ADD CONSTRAINT "transfers_version_check" CHECK ("yu_inventory"."transfers"."version" > 0);--> statement-breakpoint
CREATE FUNCTION "yu_inventory"."reject_audit_record_mutation"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'audit_records is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "audit_records_append_only"
BEFORE UPDATE OR DELETE ON "yu_inventory"."audit_records"
FOR EACH ROW
EXECUTE FUNCTION "yu_inventory"."reject_audit_record_mutation"();

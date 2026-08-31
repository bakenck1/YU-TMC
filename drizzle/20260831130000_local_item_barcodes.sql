ALTER TYPE "yu_inventory"."audit_subject_kind" ADD VALUE 'local_item_group';--> statement-breakpoint
CREATE SEQUENCE "yu_inventory"."local_barcode_sequence" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
ALTER TABLE "yu_inventory"."users" ADD COLUMN "default_room_id" uuid;--> statement-breakpoint
ALTER TABLE "yu_inventory"."users" ADD CONSTRAINT "users_default_room_id_rooms_id_fk" FOREIGN KEY ("default_room_id") REFERENCES "yu_inventory"."rooms"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
UPDATE "yu_inventory"."users" AS u
SET "default_room_id" = candidate.room_id
FROM (
  SELECT primary_responsible_id AS user_id, min(id::text)::uuid AS room_id
  FROM "yu_inventory"."rooms"
  WHERE status = 'active' AND primary_responsible_id IS NOT NULL
  GROUP BY primary_responsible_id
  HAVING count(*) = 1
) AS candidate
WHERE u.id = candidate.user_id AND u.default_room_id IS NULL;--> statement-breakpoint
CREATE TABLE "yu_inventory"."local_item_groups" (
  "id" uuid PRIMARY KEY NOT NULL,
  "item_id" uuid NOT NULL,
  "parent_group_id" uuid,
  "sequence_number" bigint NOT NULL UNIQUE,
  "barcode_value" varchar(128) NOT NULL,
  "barcode_key" text NOT NULL UNIQUE,
  "quantity" integer NOT NULL,
  "responsible_user_id" uuid NOT NULL,
  "room_id" uuid NOT NULL,
  "previous_responsible_user_id" uuid,
  "previous_room_id" uuid,
  "created_by" uuid NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "transferred_at" timestamptz DEFAULT now() NOT NULL,
  "status" varchar(16) DEFAULT 'active' NOT NULL,
  "cancelled_by" uuid,
  "cancelled_at" timestamptz,
  "cancellation_reason" varchar(1000),
  "version" integer DEFAULT 1 NOT NULL,
  CONSTRAINT "local_item_groups_quantity_check" CHECK (quantity > 0),
  CONSTRAINT "local_item_groups_sequence_check" CHECK (sequence_number > 0),
  CONSTRAINT "local_item_groups_version_check" CHECK (version > 0),
  CONSTRAINT "local_item_groups_barcode_check" CHECK (btrim(barcode_value) <> '' AND btrim(barcode_key) <> ''),
  CONSTRAINT "local_item_groups_cancellation_check" CHECK (
    (status = 'active' AND cancelled_by IS NULL AND cancelled_at IS NULL AND cancellation_reason IS NULL)
    OR (status = 'cancelled' AND cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL
      AND cancellation_reason IS NOT NULL AND btrim(cancellation_reason) <> '')
  ),
  CONSTRAINT "local_item_groups_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE restrict ON UPDATE restrict,
  CONSTRAINT "local_item_groups_parent_group_id_local_item_groups_id_fk" FOREIGN KEY ("parent_group_id") REFERENCES "yu_inventory"."local_item_groups"("id") ON DELETE restrict ON UPDATE restrict,
  CONSTRAINT "local_item_groups_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict,
  CONSTRAINT "local_item_groups_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "yu_inventory"."rooms"("id") ON DELETE restrict ON UPDATE restrict,
  CONSTRAINT "local_item_groups_previous_responsible_user_id_users_id_fk" FOREIGN KEY ("previous_responsible_user_id") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict,
  CONSTRAINT "local_item_groups_previous_room_id_rooms_id_fk" FOREIGN KEY ("previous_room_id") REFERENCES "yu_inventory"."rooms"("id") ON DELETE restrict ON UPDATE restrict,
  CONSTRAINT "local_item_groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict,
  CONSTRAINT "local_item_groups_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict
);--> statement-breakpoint
CREATE INDEX "local_item_groups_item_status_idx" ON "yu_inventory"."local_item_groups" ("item_id", "status");--> statement-breakpoint
CREATE INDEX "local_item_groups_responsible_status_idx" ON "yu_inventory"."local_item_groups" ("responsible_user_id", "status");--> statement-breakpoint
CREATE INDEX "local_item_groups_parent_idx" ON "yu_inventory"."local_item_groups" ("parent_group_id");--> statement-breakpoint
CREATE TABLE "yu_inventory"."local_item_group_events" (
  "id" uuid PRIMARY KEY NOT NULL,
  "group_id" uuid NOT NULL,
  "event_type" varchar(16) NOT NULL,
  "actor_id" uuid NOT NULL,
  "from_responsible_user_id" uuid,
  "to_responsible_user_id" uuid,
  "quantity" integer NOT NULL,
  "room_id" uuid NOT NULL,
  "reason" varchar(1000),
  "occurred_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "local_item_group_events_values_check" CHECK (
    event_type IN ('created', 'transferred', 'split', 'cancelled') AND quantity > 0
    AND (reason IS NULL OR btrim(reason) <> '')
  ),
  CONSTRAINT "local_item_group_events_group_id_local_item_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "yu_inventory"."local_item_groups"("id") ON DELETE restrict ON UPDATE restrict,
  CONSTRAINT "local_item_group_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict,
  CONSTRAINT "local_item_group_events_from_responsible_user_id_users_id_fk" FOREIGN KEY ("from_responsible_user_id") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict,
  CONSTRAINT "local_item_group_events_to_responsible_user_id_users_id_fk" FOREIGN KEY ("to_responsible_user_id") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict,
  CONSTRAINT "local_item_group_events_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "yu_inventory"."rooms"("id") ON DELETE restrict ON UPDATE restrict
);--> statement-breakpoint
CREATE INDEX "local_item_group_events_group_time_idx" ON "yu_inventory"."local_item_group_events" ("group_id", "occurred_at");--> statement-breakpoint
CREATE TABLE "yu_inventory"."barcode_registry" (
  "canonical_key" text PRIMARY KEY NOT NULL,
  "original_value" varchar(128) NOT NULL,
  "kind" varchar(16) NOT NULL,
  "item_id" uuid NOT NULL,
  "local_group_id" uuid UNIQUE,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "barcode_registry_values_check" CHECK (
    btrim(canonical_key) <> '' AND btrim(original_value) <> '' AND kind IN ('official', 'local')
    AND ((kind = 'official' AND local_group_id IS NULL) OR (kind = 'local' AND local_group_id IS NOT NULL))
  ),
  CONSTRAINT "barcode_registry_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE cascade ON UPDATE restrict,
  CONSTRAINT "barcode_registry_local_group_id_local_item_groups_id_fk" FOREIGN KEY ("local_group_id") REFERENCES "yu_inventory"."local_item_groups"("id") ON DELETE restrict ON UPDATE restrict
);--> statement-breakpoint
CREATE INDEX "barcode_registry_item_idx" ON "yu_inventory"."barcode_registry" ("item_id");--> statement-breakpoint
INSERT INTO "yu_inventory"."barcode_registry" (canonical_key, original_value, kind, item_id)
SELECT inventory_number_key, inventory_number, 'official', id FROM "yu_inventory"."items";--> statement-breakpoint
CREATE FUNCTION "yu_inventory"."sync_official_barcode_registry"() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.inventory_number_key IS DISTINCT FROM NEW.inventory_number_key THEN
    DELETE FROM "yu_inventory"."barcode_registry" WHERE canonical_key = OLD.inventory_number_key AND kind = 'official' AND item_id = OLD.id;
  END IF;
  INSERT INTO "yu_inventory"."barcode_registry" (canonical_key, original_value, kind, item_id)
  VALUES (NEW.inventory_number_key, NEW.inventory_number, 'official', NEW.id)
  ON CONFLICT (canonical_key) DO UPDATE SET original_value = EXCLUDED.original_value
  WHERE "yu_inventory"."barcode_registry".kind = 'official' AND "yu_inventory"."barcode_registry".item_id = EXCLUDED.item_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'barcode namespace conflict'; END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "items_barcode_registry_sync" AFTER INSERT OR UPDATE OF inventory_number, inventory_number_key ON "yu_inventory"."items" FOR EACH ROW EXECUTE FUNCTION "yu_inventory"."sync_official_barcode_registry"();--> statement-breakpoint
CREATE FUNCTION "yu_inventory"."register_local_barcode"() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  INSERT INTO "yu_inventory"."barcode_registry" (canonical_key, original_value, kind, item_id, local_group_id)
  VALUES (NEW.barcode_key, NEW.barcode_value, 'local', NEW.item_id, NEW.id);
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "local_item_groups_barcode_registry_insert" AFTER INSERT ON "yu_inventory"."local_item_groups" FOR EACH ROW EXECUTE FUNCTION "yu_inventory"."register_local_barcode"();--> statement-breakpoint
CREATE FUNCTION "yu_inventory"."assert_local_item_quantity"() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE target_item uuid; total_quantity bigint; registry_quantity integer;
BEGIN
  IF TG_TABLE_NAME = 'items' THEN
    target_item := COALESCE(NEW.id, OLD.id);
  ELSE
    target_item := COALESCE(NEW.item_id, OLD.item_id);
  END IF;
  SELECT quantity INTO registry_quantity FROM "yu_inventory"."items" WHERE id = target_item FOR UPDATE;
  IF registry_quantity IS NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(sum(quantity), 0) INTO total_quantity FROM "yu_inventory"."local_item_groups" WHERE item_id = target_item AND status = 'active';
  IF total_quantity > registry_quantity THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'local item quantities exceed registry quantity'; END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "local_item_groups_quantity_guard" AFTER INSERT OR UPDATE OR DELETE ON "yu_inventory"."local_item_groups" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "yu_inventory"."assert_local_item_quantity"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "items_local_quantity_guard" AFTER UPDATE OF quantity ON "yu_inventory"."items" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "yu_inventory"."assert_local_item_quantity"();--> statement-breakpoint
CREATE FUNCTION "yu_inventory"."reject_local_group_event_mutation"() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'local_item_group_events is append-only'; END $$;--> statement-breakpoint
CREATE TRIGGER "local_item_group_events_append_only" BEFORE UPDATE OR DELETE ON "yu_inventory"."local_item_group_events" FOR EACH ROW EXECUTE FUNCTION "yu_inventory"."reject_local_group_event_mutation"();

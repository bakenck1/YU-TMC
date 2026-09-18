DROP INDEX "yu_inventory"."item_inventory_number_history_key_unique";--> statement-breakpoint
DROP INDEX "yu_inventory"."items_inventory_number_key_unique";--> statement-breakpoint
ALTER TABLE "yu_inventory"."barcode_registry" DROP CONSTRAINT "barcode_registry_pkey";--> statement-breakpoint
ALTER TABLE "yu_inventory"."barcode_registry" ADD CONSTRAINT "barcode_registry_pk" PRIMARY KEY("canonical_key","item_id");--> statement-breakpoint
ALTER TABLE "yu_inventory"."rooms" ADD COLUMN "access_mode" varchar(16) DEFAULT 'open' NOT NULL;--> statement-breakpoint
CREATE INDEX "barcode_registry_key_idx" ON "yu_inventory"."barcode_registry" USING btree ("canonical_key");--> statement-breakpoint
ALTER TABLE "yu_inventory"."rooms" ADD CONSTRAINT "rooms_access_mode_check" CHECK ("yu_inventory"."rooms"."access_mode" in ('open', 'closed'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "yu_inventory"."inventory_shared_number_device"(display_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN regexp_replace(
           lower(translate(btrim(display_name),
             'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯӘҒҚҢӨҰҮҺІ',
             'абвгдеёжзийклмнопрстуфхцчшщъыьэюяәғқңөұүһі')),
           '\s+', ' ', 'g') ~ '^(монитор|monitor)(\s|$)'
      THEN 'monitor'
    WHEN regexp_replace(
           lower(translate(btrim(display_name),
             'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯӘҒҚҢӨҰҮҺІ',
             'абвгдеёжзийклмнопрстуфхцчшщъыьэюяәғқңөұүһі')),
           '\s+', ' ', 'g') ~ '^(системный блок|system unit|жүйелік блок)(\s|$)'
      THEN 'system_unit'
    ELSE NULL
  END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "yu_inventory"."assert_inventory_number_duplicate_policy"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  new_device text;
  existing_count integer;
  existing_device text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.inventory_number_key, 0));
  new_device := "yu_inventory"."inventory_shared_number_device"(NEW.name);

  SELECT count(*)::integer,
         min("yu_inventory"."inventory_shared_number_device"(other.name))
    INTO existing_count, existing_device
    FROM "yu_inventory"."items" other
   WHERE other.inventory_number_key = NEW.inventory_number_key
     AND other.id <> NEW.id;

  IF existing_count = 0 THEN
    RETURN NEW;
  END IF;
  IF existing_count = 1
     AND new_device IS NOT NULL
     AND existing_device IS NOT NULL
     AND new_device <> existing_device THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = '23505',
    MESSAGE = 'inventory number duplicate is allowed only for one monitor and one system unit';
END
$$;
--> statement-breakpoint
CREATE TRIGGER "items_inventory_number_duplicate_policy"
BEFORE INSERT OR UPDATE OF inventory_number_key, name
ON "yu_inventory"."items"
FOR EACH ROW
EXECUTE FUNCTION "yu_inventory"."assert_inventory_number_duplicate_policy"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "yu_inventory"."sync_official_barcode_registry"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.inventory_number_key, 0));
  IF TG_OP = 'UPDATE' AND OLD.inventory_number_key IS DISTINCT FROM NEW.inventory_number_key THEN
    IF EXISTS (
      SELECT 1 FROM "yu_inventory"."barcode_registry"
       WHERE canonical_key = NEW.inventory_number_key AND kind = 'local'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'barcode namespace conflict';
    END IF;
    UPDATE "yu_inventory"."barcode_registry"
       SET canonical_key = NEW.inventory_number_key,
           original_value = NEW.inventory_number
     WHERE canonical_key = OLD.inventory_number_key
       AND kind = 'official'
       AND item_id = OLD.id;
    IF FOUND THEN
      RETURN NEW;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM "yu_inventory"."barcode_registry"
     WHERE canonical_key = NEW.inventory_number_key AND kind = 'local'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'barcode namespace conflict';
  END IF;

  INSERT INTO "yu_inventory"."barcode_registry"
    (canonical_key, original_value, kind, item_id)
  VALUES (NEW.inventory_number_key, NEW.inventory_number, 'official', NEW.id)
  ON CONFLICT (canonical_key, item_id)
  DO UPDATE SET original_value = EXCLUDED.original_value;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "yu_inventory"."register_local_barcode"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  -- Official items and local groups share one namespace. The same
  -- transaction-scoped key lock is also taken by item insertion, so the
  -- conflict check remains correct when both kinds are created concurrently.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.barcode_key, 0));
  IF EXISTS (
    SELECT 1 FROM "yu_inventory"."barcode_registry"
     WHERE canonical_key = NEW.barcode_key
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'barcode namespace conflict';
  END IF;
  INSERT INTO "yu_inventory"."barcode_registry"
    (canonical_key, original_value, kind, item_id, local_group_id)
  VALUES (NEW.barcode_key, NEW.barcode_value, 'local', NEW.item_id, NEW.id);
  RETURN NEW;
END
$$;

ALTER TYPE "yu_inventory"."item_status" ADD VALUE 'broken' BEFORE 'decommissioned';--> statement-breakpoint
ALTER TABLE "yu_inventory"."items" DROP CONSTRAINT "items_display_values_check";--> statement-breakpoint
ALTER TABLE "yu_inventory"."items" ADD CONSTRAINT "items_display_values_check" CHECK (btrim("yu_inventory"."items"."name") <> ''
          AND ("yu_inventory"."items"."description" IS NULL OR btrim("yu_inventory"."items"."description") <> '')
          AND (
            ("yu_inventory"."items"."item_section" = 'general' AND btrim("yu_inventory"."items"."item_type") <> '' AND "yu_inventory"."items"."it_type" IS NULL)
            OR
            ("yu_inventory"."items"."item_section" = 'it' AND "yu_inventory"."items"."it_type" in ('wifi_access_point', 'camera') AND "yu_inventory"."items"."item_type" = "yu_inventory"."items"."it_type"::text)
          )
          AND ((btrim("yu_inventory"."items"."inventory_number") <> '' AND btrim("yu_inventory"."items"."inventory_number_key") <> '')
            OR ("yu_inventory"."items"."item_section" = 'general' AND "yu_inventory"."items"."item_type" = 'components' AND "yu_inventory"."items"."inventory_number" = '' AND "yu_inventory"."items"."inventory_number_key" = ''))
          AND "yu_inventory"."items"."quantity" > 0
          AND "yu_inventory"."items"."unit_price" >= 0);
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
  IF NEW.item_section = 'general' AND NEW.item_type = 'components' AND NEW.inventory_number = '' AND NEW.inventory_number_key = '' THEN
    RETURN NEW;
  END IF;
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
-- The trigger may remove an obsolete official identifier when a component number is cleared.
-- Run under its owner with a pinned search path; runtime table DELETE grants stay unchanged.
CREATE OR REPLACE FUNCTION "yu_inventory"."sync_official_barcode_registry"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.item_section = 'general' AND NEW.item_type = 'components' AND NEW.inventory_number = '' AND NEW.inventory_number_key = '' THEN
    DELETE FROM "yu_inventory"."barcode_registry" WHERE item_id = NEW.id AND kind = 'official';
    RETURN NEW;
  END IF;
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

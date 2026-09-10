CREATE OR REPLACE FUNCTION "yu_inventory"."sync_official_barcode_registry"() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.inventory_number_key IS DISTINCT FROM NEW.inventory_number_key THEN
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

  INSERT INTO "yu_inventory"."barcode_registry" (canonical_key, original_value, kind, item_id)
  VALUES (NEW.inventory_number_key, NEW.inventory_number, 'official', NEW.id)
  ON CONFLICT (canonical_key) DO UPDATE SET original_value = EXCLUDED.original_value
  WHERE "yu_inventory"."barcode_registry".kind = 'official'
    AND "yu_inventory"."barcode_registry".item_id = EXCLUDED.item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'barcode namespace conflict';
  END IF;
  RETURN NEW;
END $$;

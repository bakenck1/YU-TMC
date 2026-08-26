CREATE OR REPLACE FUNCTION "yu_inventory"."guard_photo_lifecycle_transition"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'reserved' AND NEW.status IN ('attached', 'expired'))
    OR (OLD.status = 'attached' AND NEW.status IN ('superseded', 'removed'))
    OR (OLD.status IN ('superseded', 'removed') AND NEW.status = 'purged')
  ) THEN
    RAISE EXCEPTION 'Invalid photo lifecycle transition: % -> %',
      OLD.status, NEW.status
      USING ERRCODE = '23514', CONSTRAINT = 'photos_lifecycle_transition';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "photos_lifecycle_transition_guard"
  ON "yu_inventory"."photos";--> statement-breakpoint
CREATE TRIGGER "photos_lifecycle_transition_guard"
BEFORE UPDATE OF "status" ON "yu_inventory"."photos"
FOR EACH ROW
EXECUTE FUNCTION "yu_inventory"."guard_photo_lifecycle_transition"();

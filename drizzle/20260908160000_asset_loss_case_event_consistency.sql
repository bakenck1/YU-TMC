DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM "yu_inventory"."asset_loss_cases" AS loss_case
      LEFT JOIN LATERAL (
        SELECT event.to_status
          FROM "yu_inventory"."asset_loss_case_events" AS event
         WHERE event.loss_case_id = loss_case.id
         ORDER BY event.occurred_at DESC, event.id DESC
         LIMIT 1
      ) AS latest_event ON true
     WHERE latest_event.to_status IS NULL
        OR latest_event.to_status IS DISTINCT FROM loss_case.status
  ) THEN
    RAISE EXCEPTION 'existing asset loss case status must match latest event' USING ERRCODE = '23514';
  END IF;
END;
$$;--> statement-breakpoint

CREATE FUNCTION "yu_inventory"."enforce_asset_loss_case_event_consistency"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  case_status varchar(32);
  latest_status varchar(32);
BEGIN
  SELECT status INTO case_status
    FROM "yu_inventory"."asset_loss_cases"
   WHERE id = NEW.id;

  SELECT to_status INTO latest_status
    FROM "yu_inventory"."asset_loss_case_events"
   WHERE loss_case_id = NEW.id
   ORDER BY occurred_at DESC, id DESC
   LIMIT 1;

  IF case_status IS NULL OR latest_status IS NULL OR latest_status IS DISTINCT FROM case_status THEN
    RAISE EXCEPTION 'asset loss case status must match latest event' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER "asset_loss_cases_event_consistency"
AFTER INSERT OR UPDATE OF status ON "yu_inventory"."asset_loss_cases"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "yu_inventory"."enforce_asset_loss_case_event_consistency"();

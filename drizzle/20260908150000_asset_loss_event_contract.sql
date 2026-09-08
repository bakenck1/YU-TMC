ALTER TABLE "yu_inventory"."asset_loss_cases"
  ADD COLUMN "responsibility_period_id" uuid;--> statement-breakpoint

UPDATE "yu_inventory"."asset_loss_cases" loss
   SET "responsibility_period_id" = (
    SELECT period.id
      FROM "yu_inventory"."responsibility_periods" period
     WHERE period.item_id = loss.item_id
       AND period.responsible_user_id = loss.employee_id
       AND period.started_at <= loss.created_at
       AND (period.ended_at IS NULL OR period.ended_at >= loss.created_at)
     ORDER BY period.started_at DESC, period.id
     LIMIT 1
  );--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "yu_inventory"."asset_loss_cases"
     WHERE status <> 'closed' AND responsibility_period_id IS NULL
  ) THEN
    RAISE EXCEPTION 'cannot establish responsibility snapshot for an open asset-loss case'
      USING ERRCODE = '23514';
  END IF;
END;
$$;--> statement-breakpoint

ALTER TABLE "yu_inventory"."asset_loss_cases"
  ADD CONSTRAINT "asset_loss_cases_responsibility_period_id_responsibility_periods_id_fk"
  FOREIGN KEY ("responsibility_period_id") REFERENCES "yu_inventory"."responsibility_periods"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint

ALTER TABLE "yu_inventory"."asset_loss_cases"
  ADD CONSTRAINT "asset_loss_cases_open_responsibility_snapshot_check"
  CHECK ("status" = 'closed' OR "responsibility_period_id" IS NOT NULL);--> statement-breakpoint

ALTER TABLE "yu_inventory"."asset_loss_case_events"
  ADD CONSTRAINT "asset_loss_case_events_status_check"
  CHECK (
    ("from_status" IS NULL OR "from_status" IN ('payment_pending', 'accounting_review', 'rejected', 'closed'))
    AND "to_status" IN ('payment_pending', 'accounting_review', 'rejected', 'closed')
    AND "from_status" IS DISTINCT FROM "to_status"
  );--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM "yu_inventory"."asset_loss_cases" loss
      LEFT JOIN LATERAL (
        SELECT event.to_status
          FROM "yu_inventory"."asset_loss_case_events" event
         WHERE event.loss_case_id = loss.id
         ORDER BY event.occurred_at DESC, event.id DESC
         LIMIT 1
      ) latest ON true
     WHERE latest.to_status IS NULL OR latest.to_status IS DISTINCT FROM loss.status
  ) THEN
    RAISE EXCEPTION 'asset-loss event history does not match current case state'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (
        SELECT from_status, row_number() OVER chain AS edge_number,
               lag(to_status) OVER chain AS previous_status
          FROM "yu_inventory"."asset_loss_case_events"
        WINDOW chain AS (PARTITION BY loss_case_id ORDER BY occurred_at, id)
      ) edge
     WHERE (edge_number = 1 AND from_status IS NOT NULL)
        OR (edge_number > 1 AND from_status IS DISTINCT FROM previous_status)
  ) THEN
    RAISE EXCEPTION 'asset-loss event history is discontinuous'
      USING ERRCODE = '23514';
  END IF;
END;
$$;--> statement-breakpoint

CREATE FUNCTION "yu_inventory"."enforce_asset_loss_event_chain"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  case_status varchar(32);
  previous_status varchar(32);
BEGIN
  SELECT status INTO case_status
    FROM "yu_inventory"."asset_loss_cases"
   WHERE id = NEW.loss_case_id
   FOR SHARE;

  IF case_status IS DISTINCT FROM NEW.to_status THEN
    RAISE EXCEPTION 'asset loss event target must match case status' USING ERRCODE = '23514';
  END IF;

  SELECT to_status INTO previous_status
    FROM "yu_inventory"."asset_loss_case_events"
   WHERE loss_case_id = NEW.loss_case_id
   ORDER BY occurred_at DESC, id DESC
   LIMIT 1;

  IF previous_status IS NULL THEN
    IF NEW.from_status IS NOT NULL OR NEW.to_status <> 'payment_pending' THEN
      RAISE EXCEPTION 'invalid initial asset loss event' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.from_status IS DISTINCT FROM previous_status THEN
    RAISE EXCEPTION 'asset loss event chain is discontinuous' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "asset_loss_case_events_chain"
BEFORE INSERT ON "yu_inventory"."asset_loss_case_events"
FOR EACH ROW EXECUTE FUNCTION "yu_inventory"."enforce_asset_loss_event_chain"();--> statement-breakpoint

CREATE FUNCTION "yu_inventory"."prevent_asset_loss_event_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'asset loss events are append-only' USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint

CREATE TRIGGER "asset_loss_case_events_append_only"
BEFORE UPDATE OR DELETE ON "yu_inventory"."asset_loss_case_events"
FOR EACH ROW EXECUTE FUNCTION "yu_inventory"."prevent_asset_loss_event_mutation"();

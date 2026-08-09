CREATE TYPE "yu_inventory"."tmc_transfer_item_result" AS ENUM('pending', 'accepted', 'rejected', 'cancelled', 'invalidated');--> statement-breakpoint
CREATE TYPE "yu_inventory"."tmc_transfer_request_status" AS ENUM('pending', 'accepted', 'rejected', 'cancelled');--> statement-breakpoint
ALTER TYPE "yu_inventory"."notification_event_type" ADD VALUE 'tmc_transfer.requested' BEFORE 'decision.created';--> statement-breakpoint
ALTER TYPE "yu_inventory"."notification_event_type" ADD VALUE 'tmc_transfer.completed' BEFORE 'decision.created';--> statement-breakpoint
ALTER TYPE "yu_inventory"."notification_event_type" ADD VALUE 'tmc_transfer.overdue' BEFORE 'decision.created';--> statement-breakpoint
ALTER TYPE "yu_inventory"."notification_subject_kind" ADD VALUE 'tmc_transfer_request' BEFORE 'decision';--> statement-breakpoint
CREATE TABLE "yu_inventory"."tmc_operation_notifications" (
	"notification_event_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tmc_operation_notifications_pk" PRIMARY KEY("notification_event_id")
);
--> statement-breakpoint
CREATE TABLE "yu_inventory"."tmc_transfer_request_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"responsibility_period_id_at_request" uuid NOT NULL,
	"current_responsible_id_at_request" uuid NOT NULL,
	"result" "yu_inventory"."tmc_transfer_item_result" DEFAULT 'pending' NOT NULL,
	"invalid_reason" varchar(1000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "tmc_transfer_request_items_request_item_unique" UNIQUE("request_id","item_id"),
	CONSTRAINT "tmc_transfer_request_items_state_check" CHECK ((
            "yu_inventory"."tmc_transfer_request_items"."result" = 'pending'
            AND "yu_inventory"."tmc_transfer_request_items"."decided_at" IS NULL
            AND "yu_inventory"."tmc_transfer_request_items"."decided_by" IS NULL
            AND "yu_inventory"."tmc_transfer_request_items"."invalid_reason" IS NULL
          ) OR (
            "yu_inventory"."tmc_transfer_request_items"."result" <> 'pending'
            AND "yu_inventory"."tmc_transfer_request_items"."decided_at" IS NOT NULL
            AND "yu_inventory"."tmc_transfer_request_items"."decided_by" IS NOT NULL
            AND (
              (
                "yu_inventory"."tmc_transfer_request_items"."result" = 'invalidated'
                AND "yu_inventory"."tmc_transfer_request_items"."invalid_reason" IS NOT NULL
                AND btrim("yu_inventory"."tmc_transfer_request_items"."invalid_reason") <> ''
              ) OR (
                "yu_inventory"."tmc_transfer_request_items"."result" <> 'invalidated'
                AND "yu_inventory"."tmc_transfer_request_items"."invalid_reason" IS NULL
              )
            )
          )),
	CONSTRAINT "tmc_transfer_request_items_time_check" CHECK ("yu_inventory"."tmc_transfer_request_items"."decided_at" IS NULL OR "yu_inventory"."tmc_transfer_request_items"."decided_at" >= "yu_inventory"."tmc_transfer_request_items"."created_at"),
	CONSTRAINT "tmc_transfer_request_items_version_check" CHECK ("yu_inventory"."tmc_transfer_request_items"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "yu_inventory"."tmc_transfer_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"initiator_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"status" "yu_inventory"."tmc_transfer_request_status" DEFAULT 'pending' NOT NULL,
	"comment" varchar(1000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '24 hours' NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"is_administrative_decision" boolean DEFAULT false NOT NULL,
	"administrative_reason" varchar(1000),
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "tmc_transfer_requests_participants_check" CHECK ("yu_inventory"."tmc_transfer_requests"."initiator_id" <> "yu_inventory"."tmc_transfer_requests"."recipient_id"),
	CONSTRAINT "tmc_transfer_requests_comment_check" CHECK ("yu_inventory"."tmc_transfer_requests"."comment" IS NULL OR btrim("yu_inventory"."tmc_transfer_requests"."comment") <> ''),
	CONSTRAINT "tmc_transfer_requests_state_check" CHECK ((
            "yu_inventory"."tmc_transfer_requests"."status" = 'pending'
            AND "yu_inventory"."tmc_transfer_requests"."closed_at" IS NULL
            AND "yu_inventory"."tmc_transfer_requests"."closed_by" IS NULL
            AND "yu_inventory"."tmc_transfer_requests"."is_administrative_decision" = false
            AND "yu_inventory"."tmc_transfer_requests"."administrative_reason" IS NULL
          ) OR (
            "yu_inventory"."tmc_transfer_requests"."status" <> 'pending'
            AND "yu_inventory"."tmc_transfer_requests"."closed_at" IS NOT NULL
            AND "yu_inventory"."tmc_transfer_requests"."closed_by" IS NOT NULL
            AND (
              (
                "yu_inventory"."tmc_transfer_requests"."is_administrative_decision" = true
                AND "yu_inventory"."tmc_transfer_requests"."administrative_reason" IS NOT NULL
                AND btrim("yu_inventory"."tmc_transfer_requests"."administrative_reason") <> ''
              ) OR (
                "yu_inventory"."tmc_transfer_requests"."is_administrative_decision" = false
                AND "yu_inventory"."tmc_transfer_requests"."administrative_reason" IS NULL
              )
            )
          )),
	CONSTRAINT "tmc_transfer_requests_time_check" CHECK ("yu_inventory"."tmc_transfer_requests"."expires_at" > "yu_inventory"."tmc_transfer_requests"."created_at"
          AND ("yu_inventory"."tmc_transfer_requests"."closed_at" IS NULL OR "yu_inventory"."tmc_transfer_requests"."closed_at" >= "yu_inventory"."tmc_transfer_requests"."created_at")),
	CONSTRAINT "tmc_transfer_requests_version_check" CHECK ("yu_inventory"."tmc_transfer_requests"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "yu_inventory"."tmc_operation_notifications" ADD CONSTRAINT "tmc_operation_notifications_notification_event_id_notification_events_id_fk" FOREIGN KEY ("notification_event_id") REFERENCES "yu_inventory"."notification_events"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."tmc_operation_notifications" ADD CONSTRAINT "tmc_operation_notifications_request_id_tmc_transfer_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "yu_inventory"."tmc_transfer_requests"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."tmc_operation_notifications" ADD CONSTRAINT "tmc_operation_notifications_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."tmc_transfer_request_items" ADD CONSTRAINT "tmc_transfer_request_items_request_id_tmc_transfer_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "yu_inventory"."tmc_transfer_requests"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."tmc_transfer_request_items" ADD CONSTRAINT "tmc_transfer_request_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."tmc_transfer_request_items" ADD CONSTRAINT "tmc_transfer_request_items_current_responsible_id_at_request_users_id_fk" FOREIGN KEY ("current_responsible_id_at_request") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."tmc_transfer_request_items" ADD CONSTRAINT "tmc_transfer_request_items_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."responsibility_periods" ADD CONSTRAINT "responsibility_periods_tmc_snapshot_unique" UNIQUE("id","item_id","responsible_user_id");--> statement-breakpoint
ALTER TABLE "yu_inventory"."tmc_transfer_request_items" ADD CONSTRAINT "tmc_transfer_request_items_period_snapshot_fk" FOREIGN KEY ("responsibility_period_id_at_request","item_id","current_responsible_id_at_request") REFERENCES "yu_inventory"."responsibility_periods"("id","item_id","responsible_user_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."tmc_transfer_requests" ADD CONSTRAINT "tmc_transfer_requests_initiator_id_users_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."tmc_transfer_requests" ADD CONSTRAINT "tmc_transfer_requests_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."tmc_transfer_requests" ADD CONSTRAINT "tmc_transfer_requests_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "tmc_operation_notifications_request_idx" ON "yu_inventory"."tmc_operation_notifications" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "tmc_operation_notifications_item_idx" ON "yu_inventory"."tmc_operation_notifications" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tmc_transfer_request_items_pending_item_unique" ON "yu_inventory"."tmc_transfer_request_items" USING btree ("item_id") WHERE "yu_inventory"."tmc_transfer_request_items"."result" = 'pending';--> statement-breakpoint
CREATE INDEX "tmc_transfer_request_items_request_result_idx" ON "yu_inventory"."tmc_transfer_request_items" USING btree ("request_id","result");--> statement-breakpoint
CREATE INDEX "tmc_transfer_request_items_item_result_idx" ON "yu_inventory"."tmc_transfer_request_items" USING btree ("item_id","result");--> statement-breakpoint
CREATE INDEX "tmc_transfer_requests_status_expires_idx" ON "yu_inventory"."tmc_transfer_requests" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "tmc_transfer_requests_recipient_status_created_idx" ON "yu_inventory"."tmc_transfer_requests" USING btree ("recipient_id","status","created_at");--> statement-breakpoint
CREATE INDEX "tmc_transfer_requests_initiator_created_idx" ON "yu_inventory"."tmc_transfer_requests" USING btree ("initiator_id","created_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "yu_inventory"."enforce_single_active_item_transfer"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.item_id::text, 731003));

  IF TG_TABLE_NAME = 'transfers' THEN
    IF NEW.status = 'pending_current_owner' AND EXISTS (
      SELECT 1
      FROM "yu_inventory"."tmc_transfer_request_items" request_item
      WHERE request_item.item_id = NEW.item_id
        AND request_item.result = 'pending'
    ) THEN
      RAISE EXCEPTION 'item already has an active TMC transfer request'
        USING ERRCODE = '23505',
              CONSTRAINT = 'tmc_active_item_transfer_unique';
    END IF;
  ELSIF NEW.result = 'pending' AND EXISTS (
    SELECT 1
    FROM "yu_inventory"."transfers" legacy_transfer
    WHERE legacy_transfer.item_id = NEW.item_id
      AND legacy_transfer.status = 'pending_current_owner'
  ) THEN
    RAISE EXCEPTION 'item already has an active legacy transfer request'
      USING ERRCODE = '23505',
            CONSTRAINT = 'tmc_active_item_transfer_unique';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "transfers_single_active_item_trigger"
BEFORE INSERT OR UPDATE OF item_id, status
ON "yu_inventory"."transfers"
FOR EACH ROW
EXECUTE FUNCTION "yu_inventory"."enforce_single_active_item_transfer"();--> statement-breakpoint
CREATE TRIGGER "tmc_request_items_single_active_item_trigger"
BEFORE INSERT OR UPDATE OF item_id, result
ON "yu_inventory"."tmc_transfer_request_items"
FOR EACH ROW
EXECUTE FUNCTION "yu_inventory"."enforce_single_active_item_transfer"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "yu_inventory"."enforce_tmc_notification_event"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  event_type text;
  event_subject_kind text;
  event_subject_id uuid;
BEGIN
  SELECT event.type::text, event.subject_kind::text, event.subject_id
    INTO event_type, event_subject_kind, event_subject_id
  FROM "yu_inventory"."notification_events" event
  WHERE event.id = NEW.notification_event_id
  FOR SHARE;

  IF event_subject_kind IS DISTINCT FROM 'tmc_transfer_request'
     OR event_subject_id IS DISTINCT FROM NEW.request_id
     OR event_type NOT IN (
       'tmc_transfer.requested',
       'tmc_transfer.completed',
       'tmc_transfer.overdue'
     )
     OR (
       NEW.item_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM "yu_inventory"."tmc_transfer_request_items" request_item
         WHERE request_item.request_id = NEW.request_id
           AND request_item.item_id = NEW.item_id
       )
     )
  THEN
    RAISE EXCEPTION 'notification event does not match the TMC request'
      USING ERRCODE = '23514',
            CONSTRAINT = 'tmc_operation_notifications_event_check';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tmc_operation_notifications_event_trigger"
BEFORE INSERT OR UPDATE OF notification_event_id, request_id, item_id
ON "yu_inventory"."tmc_operation_notifications"
FOR EACH ROW
EXECUTE FUNCTION "yu_inventory"."enforce_tmc_notification_event"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "yu_inventory"."protect_tmc_notification_event"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "yu_inventory"."tmc_operation_notifications" notification
    WHERE notification.notification_event_id = NEW.id
      AND (
        NEW.subject_kind::text IS DISTINCT FROM 'tmc_transfer_request'
        OR NEW.subject_id IS DISTINCT FROM notification.request_id
        OR NEW.type::text NOT IN (
          'tmc_transfer.requested',
          'tmc_transfer.completed',
          'tmc_transfer.overdue'
        )
      )
  )
  THEN
    RAISE EXCEPTION 'linked notification event must remain consistent with the TMC request'
      USING ERRCODE = '23514',
            CONSTRAINT = 'tmc_operation_notifications_event_check';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "notification_events_tmc_consistency_trigger"
BEFORE UPDATE OF type, subject_kind, subject_id
ON "yu_inventory"."notification_events"
FOR EACH ROW
EXECUTE FUNCTION "yu_inventory"."protect_tmc_notification_event"();

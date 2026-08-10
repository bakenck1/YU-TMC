ALTER TYPE "yu_inventory"."notification_event_type"
  ADD VALUE IF NOT EXISTS 'tmc_transfer.cancelled';--> statement-breakpoint
ALTER TYPE "yu_inventory"."notification_event_type"
  ADD VALUE IF NOT EXISTS 'tmc_transfer.problem';--> statement-breakpoint
ALTER TYPE "yu_inventory"."audit_subject_kind"
  ADD VALUE IF NOT EXISTS 'tmc_transfer_request';--> statement-breakpoint
CREATE TABLE "yu_inventory"."tmc_web_push_outbox" (
  "notification_event_id" uuid PRIMARY KEY NOT NULL REFERENCES "yu_inventory"."notification_events"("id") ON DELETE CASCADE,
  "available_at" timestamp with time zone NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "locked_by" uuid,
  "locked_until" timestamp with time zone,
  "processed_at" timestamp with time zone,
  "dead_lettered_at" timestamp with time zone,
  "last_error_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tmc_web_push_outbox_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "tmc_web_push_outbox_lock_check" CHECK (("locked_by" IS NULL) = ("locked_until" IS NULL))
);--> statement-breakpoint
CREATE INDEX "tmc_web_push_outbox_due_idx"
  ON "yu_inventory"."tmc_web_push_outbox" ("available_at", "notification_event_id")
  WHERE "processed_at" IS NULL AND "dead_lettered_at" IS NULL;--> statement-breakpoint
CREATE TABLE "yu_inventory"."tmc_web_push_delivery_attempts" (
  "notification_event_id" uuid NOT NULL REFERENCES "yu_inventory"."notification_events"("id") ON DELETE CASCADE,
  "subscription_id" uuid NOT NULL REFERENCES "yu_inventory"."web_push_subscriptions"("id") ON DELETE CASCADE,
  "subscription_updated_at" timestamp with time zone NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "locked_by" uuid,
  "locked_until" timestamp with time zone,
  "delivered_at" timestamp with time zone,
  "last_error_code" text,
  CONSTRAINT "tmc_web_push_delivery_attempts_pk" PRIMARY KEY ("notification_event_id", "subscription_id"),
  CONSTRAINT "tmc_web_push_delivery_attempts_count_check" CHECK ("attempts" >= 0),
  CONSTRAINT "tmc_web_push_delivery_attempts_lock_check" CHECK (("locked_by" IS NULL) = ("locked_until" IS NULL))
);--> statement-breakpoint
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
       'tmc_transfer.requested', 'tmc_transfer.completed',
       'tmc_transfer.cancelled', 'tmc_transfer.problem', 'tmc_transfer.overdue'
     )
     OR (NEW.item_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM "yu_inventory"."tmc_transfer_request_items" request_item
       WHERE request_item.request_id = NEW.request_id
         AND request_item.item_id = NEW.item_id
     ))
  THEN
    RAISE EXCEPTION 'notification event does not match the TMC request'
      USING ERRCODE = '23514', CONSTRAINT = 'tmc_operation_notifications_event_check';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "yu_inventory"."protect_tmc_notification_event"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "yu_inventory"."tmc_operation_notifications" notification
    WHERE notification.notification_event_id = NEW.id
      AND (
        NEW.subject_kind::text IS DISTINCT FROM 'tmc_transfer_request'
        OR NEW.subject_id IS DISTINCT FROM notification.request_id
        OR NEW.type::text NOT IN (
          'tmc_transfer.requested', 'tmc_transfer.completed',
          'tmc_transfer.cancelled', 'tmc_transfer.problem', 'tmc_transfer.overdue'
        )
      )
  ) THEN
    RAISE EXCEPTION 'linked notification event must remain consistent with the TMC request'
      USING ERRCODE = '23514', CONSTRAINT = 'tmc_operation_notifications_event_check';
  END IF;
  RETURN NEW;
END;
$$;

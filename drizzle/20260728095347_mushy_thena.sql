CREATE TYPE "yu_inventory"."audit_subject_kind" AS ENUM('user', 'building', 'room', 'item', 'qr_identifier', 'photo', 'responsibility', 'transfer', 'inspection', 'inspection_room', 'item_result', 'deviation_decision', 'notification');--> statement-breakpoint
CREATE TYPE "yu_inventory"."decision_recipient_kind" AS ENUM('user', 'admin_queue');--> statement-breakpoint
CREATE TYPE "yu_inventory"."decision_resolution" AS ENUM('confirm_result', 'dismiss_to_present');--> statement-breakpoint
CREATE TYPE "yu_inventory"."decision_status" AS ENUM('pending', 'confirmed', 'disputed', 'superseded', 'resolved_by_admin');--> statement-breakpoint
CREATE TYPE "yu_inventory"."inspection_status" AS ENUM('draft', 'awaiting_decisions', 'confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "yu_inventory"."inventory_number_kind" AS ENUM('official', 'temporary');--> statement-breakpoint
CREATE TYPE "yu_inventory"."item_result_value" AS ENUM('present', 'missing', 'moved', 'broken', 'undetermined');--> statement-breakpoint
CREATE TYPE "yu_inventory"."item_status" AS ENUM('active', 'maintenance', 'decommissioned');--> statement-breakpoint
CREATE TYPE "yu_inventory"."notification_audience_kind" AS ENUM('direct_user', 'admin_queue');--> statement-breakpoint
CREATE TYPE "yu_inventory"."notification_event_type" AS ENUM('transfer.requested', 'transfer.confirmed', 'transfer.rejected', 'transfer.cancelled', 'transfer.overridden', 'decision.created', 'decision.admin_queue_created', 'decision.disputed', 'decision.recheck_requested', 'decision.closed_present', 'decision.resolved_by_admin', 'decision.admin_queue_resolved', 'inspection.confirmed');--> statement-breakpoint
CREATE TYPE "yu_inventory"."notification_mailbox_kind" AS ENUM('direct_user', 'admin_queue');--> statement-breakpoint
CREATE TYPE "yu_inventory"."notification_subject_kind" AS ENUM('item', 'transfer', 'decision', 'inspection');--> statement-breakpoint
CREATE TYPE "yu_inventory"."photo_purpose" AS ENUM('item', 'inspection_result', 'decision_dispute');--> statement-breakpoint
CREATE TYPE "yu_inventory"."photo_status" AS ENUM('reserved', 'attached', 'superseded', 'removed', 'expired', 'purged');--> statement-breakpoint
CREATE TYPE "yu_inventory"."qr_format" AS ENUM('generated_v1', 'legacy_raw', 'legacy_url');--> statement-breakpoint
CREATE TYPE "yu_inventory"."qr_role" AS ENUM('primary', 'alias');--> statement-breakpoint
CREATE TYPE "yu_inventory"."qr_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "yu_inventory"."qr_target_kind" AS ENUM('building', 'room', 'item');--> statement-breakpoint
CREATE TYPE "yu_inventory"."record_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "yu_inventory"."responsibility_source" AS ENUM('accepted', 'transfer', 'admin_override', 'migration');--> statement-breakpoint
CREATE TYPE "yu_inventory"."transfer_status" AS ENUM('pending_current_owner', 'confirmed', 'rejected', 'cancelled', 'overridden');--> statement-breakpoint
CREATE TABLE "yu_inventory"."audit_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"domain_event_id" uuid,
	"actor_id" uuid,
	"actor_role_snapshot" "yu_inventory"."auth_role",
	"subject_kind" "yu_inventory"."audit_subject_kind" NOT NULL,
	"subject_id" uuid NOT NULL,
	"subject_revision" integer,
	"action" varchar(80) NOT NULL,
	"before_values" jsonb,
	"after_values" jsonb,
	"reason" varchar(1000),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_records_actor_snapshot_check" CHECK (("yu_inventory"."audit_records"."actor_id" IS NULL) = ("yu_inventory"."audit_records"."actor_role_snapshot" IS NULL)),
	CONSTRAINT "audit_records_action_check" CHECK (btrim("yu_inventory"."audit_records"."action") <> ''),
	CONSTRAINT "audit_records_snapshot_check" CHECK ("yu_inventory"."audit_records"."before_values" IS NOT NULL OR "yu_inventory"."audit_records"."after_values" IS NOT NULL),
	CONSTRAINT "audit_records_subject_revision_check" CHECK ("yu_inventory"."audit_records"."subject_revision" IS NULL OR "yu_inventory"."audit_records"."subject_revision" > 0),
	CONSTRAINT "audit_records_reason_check" CHECK ("yu_inventory"."audit_records"."reason" IS NULL OR btrim("yu_inventory"."audit_records"."reason") <> '')
);
--> statement-breakpoint
CREATE TABLE "yu_inventory"."buildings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"name_key" text NOT NULL,
	"address" varchar(300) NOT NULL,
	"address_key" text NOT NULL,
	"status" "yu_inventory"."record_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "buildings_display_values_check" CHECK (btrim("yu_inventory"."buildings"."name") <> '' AND btrim("yu_inventory"."buildings"."name_key") <> '' AND btrim("yu_inventory"."buildings"."address") <> '' AND btrim("yu_inventory"."buildings"."address_key") <> ''),
	CONSTRAINT "buildings_archive_state_check" CHECK (("yu_inventory"."buildings"."status" = 'active' AND "yu_inventory"."buildings"."archived_at" IS NULL AND "yu_inventory"."buildings"."archived_by" IS NULL)
          OR ("yu_inventory"."buildings"."status" = 'archived' AND "yu_inventory"."buildings"."archived_at" IS NOT NULL AND "yu_inventory"."buildings"."archived_by" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "yu_inventory"."deviation_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"result_id" uuid NOT NULL,
	"result_revision_number" integer NOT NULL,
	"previous_decision_id" uuid,
	"recipient_kind" "yu_inventory"."decision_recipient_kind" NOT NULL,
	"recipient_id" uuid,
	"status" "yu_inventory"."decision_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"acted_at" timestamp with time zone,
	"acted_by" uuid,
	"comment" varchar(1000),
	"resolution" "yu_inventory"."decision_resolution",
	"administrative_reason" varchar(1000),
	CONSTRAINT "deviation_decisions_id_result_unique" UNIQUE("id","result_id"),
	CONSTRAINT "deviation_decisions_recipient_check" CHECK (("yu_inventory"."deviation_decisions"."recipient_kind" = 'user' AND "yu_inventory"."deviation_decisions"."recipient_id" IS NOT NULL)
          OR ("yu_inventory"."deviation_decisions"."recipient_kind" = 'admin_queue' AND "yu_inventory"."deviation_decisions"."recipient_id" IS NULL)),
	CONSTRAINT "deviation_decisions_state_check" CHECK ((
            "yu_inventory"."deviation_decisions"."status" = 'pending'
            AND "yu_inventory"."deviation_decisions"."acted_at" IS NULL
            AND "yu_inventory"."deviation_decisions"."acted_by" IS NULL
            AND "yu_inventory"."deviation_decisions"."resolution" IS NULL
          ) OR (
            "yu_inventory"."deviation_decisions"."status" <> 'pending'
            AND "yu_inventory"."deviation_decisions"."acted_at" IS NOT NULL
            AND "yu_inventory"."deviation_decisions"."acted_by" IS NOT NULL
          )),
	CONSTRAINT "deviation_decisions_resolution_check" CHECK (("yu_inventory"."deviation_decisions"."status" = 'resolved_by_admin') = ("yu_inventory"."deviation_decisions"."resolution" IS NOT NULL)),
	CONSTRAINT "deviation_decisions_recipient_actor_check" CHECK ("yu_inventory"."deviation_decisions"."status" NOT IN ('confirmed', 'disputed')
          OR (
            "yu_inventory"."deviation_decisions"."recipient_kind" = 'user'
            AND "yu_inventory"."deviation_decisions"."acted_by" = "yu_inventory"."deviation_decisions"."recipient_id"
          )),
	CONSTRAINT "deviation_decisions_dispute_comment_check" CHECK ("yu_inventory"."deviation_decisions"."status" <> 'disputed'
          OR (
            "yu_inventory"."deviation_decisions"."comment" IS NOT NULL
            AND btrim("yu_inventory"."deviation_decisions"."comment") <> ''
          )),
	CONSTRAINT "deviation_decisions_comment_check" CHECK ("yu_inventory"."deviation_decisions"."comment" IS NULL OR btrim("yu_inventory"."deviation_decisions"."comment") <> ''),
	CONSTRAINT "deviation_decisions_previous_not_self_check" CHECK ("yu_inventory"."deviation_decisions"."previous_decision_id" IS NULL OR "yu_inventory"."deviation_decisions"."previous_decision_id" <> "yu_inventory"."deviation_decisions"."id")
);
--> statement-breakpoint
CREATE TABLE "yu_inventory"."inspection_room_items" (
	"inspection_room_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"registry_room_id" uuid NOT NULL,
	"responsible_user_id" uuid,
	"item_name_snapshot" varchar(160) NOT NULL,
	"inventory_number_kind_snapshot" "yu_inventory"."inventory_number_kind" NOT NULL,
	"inventory_number_snapshot" varchar(64) NOT NULL,
	"building_name_snapshot" varchar(120) NOT NULL,
	"room_designation_snapshot" varchar(80) NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inspection_room_items_pk" PRIMARY KEY("inspection_room_id","item_id"),
	CONSTRAINT "inspection_room_items_snapshot_check" CHECK (btrim("yu_inventory"."inspection_room_items"."item_name_snapshot") <> ''
          AND btrim("yu_inventory"."inspection_room_items"."inventory_number_snapshot") <> ''
          AND btrim("yu_inventory"."inspection_room_items"."building_name_snapshot") <> ''
          AND btrim("yu_inventory"."inspection_room_items"."room_designation_snapshot") <> '')
);
--> statement-breakpoint
CREATE TABLE "yu_inventory"."inspection_rooms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"inspection_id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"building_name_snapshot" varchar(120) NOT NULL,
	"building_address_snapshot" varchar(300) NOT NULL,
	"room_designation_snapshot" varchar(80) NOT NULL,
	"room_floor_number_snapshot" integer NOT NULL,
	"room_floor_label_snapshot" varchar(40),
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"added_by" uuid NOT NULL,
	"inspected_at" timestamp with time zone,
	"inspected_by" uuid,
	CONSTRAINT "inspection_rooms_inspection_room_unique" UNIQUE("inspection_id","room_id"),
	CONSTRAINT "inspection_rooms_id_inspection_unique" UNIQUE("id","inspection_id"),
	CONSTRAINT "inspection_rooms_id_room_unique" UNIQUE("id","room_id"),
	CONSTRAINT "inspection_rooms_snapshot_check" CHECK (btrim("yu_inventory"."inspection_rooms"."building_name_snapshot") <> ''
          AND btrim("yu_inventory"."inspection_rooms"."building_address_snapshot") <> ''
          AND btrim("yu_inventory"."inspection_rooms"."room_designation_snapshot") <> ''
          AND "yu_inventory"."inspection_rooms"."room_floor_number_snapshot" BETWEEN -5 AND 200
          AND (
            "yu_inventory"."inspection_rooms"."room_floor_label_snapshot" IS NULL
            OR btrim("yu_inventory"."inspection_rooms"."room_floor_label_snapshot") <> ''
          )),
	CONSTRAINT "inspection_rooms_inspected_state_check" CHECK (("yu_inventory"."inspection_rooms"."inspected_at" IS NULL) = ("yu_inventory"."inspection_rooms"."inspected_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "yu_inventory"."inspections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"technician_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"status" "yu_inventory"."inspection_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"walkthrough_completed_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" varchar(1000),
	CONSTRAINT "inspections_name_check" CHECK (btrim("yu_inventory"."inspections"."name") <> ''),
	CONSTRAINT "inspections_state_check" CHECK ((
            "yu_inventory"."inspections"."status" = 'draft'
            AND "yu_inventory"."inspections"."walkthrough_completed_at" IS NULL
            AND "yu_inventory"."inspections"."confirmed_at" IS NULL
            AND "yu_inventory"."inspections"."cancelled_at" IS NULL
            AND "yu_inventory"."inspections"."cancelled_by" IS NULL
            AND "yu_inventory"."inspections"."cancel_reason" IS NULL
          ) OR (
            "yu_inventory"."inspections"."status" = 'awaiting_decisions'
            AND "yu_inventory"."inspections"."walkthrough_completed_at" IS NOT NULL
            AND "yu_inventory"."inspections"."confirmed_at" IS NULL
            AND "yu_inventory"."inspections"."cancelled_at" IS NULL
            AND "yu_inventory"."inspections"."cancelled_by" IS NULL
            AND "yu_inventory"."inspections"."cancel_reason" IS NULL
          ) OR (
            "yu_inventory"."inspections"."status" = 'confirmed'
            AND "yu_inventory"."inspections"."walkthrough_completed_at" IS NOT NULL
            AND "yu_inventory"."inspections"."confirmed_at" IS NOT NULL
            AND "yu_inventory"."inspections"."cancelled_at" IS NULL
            AND "yu_inventory"."inspections"."cancelled_by" IS NULL
            AND "yu_inventory"."inspections"."cancel_reason" IS NULL
          ) OR (
            "yu_inventory"."inspections"."status" = 'cancelled'
            AND "yu_inventory"."inspections"."walkthrough_completed_at" IS NULL
            AND "yu_inventory"."inspections"."confirmed_at" IS NULL
            AND "yu_inventory"."inspections"."cancelled_at" IS NOT NULL
            AND "yu_inventory"."inspections"."cancelled_by" IS NOT NULL
            AND "yu_inventory"."inspections"."cancel_reason" IS NOT NULL
            AND btrim("yu_inventory"."inspections"."cancel_reason") <> ''
          ))
);
--> statement-breakpoint
CREATE TABLE "yu_inventory"."item_inventory_number_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" "yu_inventory"."inventory_number_kind" NOT NULL,
	"value" varchar(64) NOT NULL,
	"comparison_key" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" uuid NOT NULL,
	"replaced_at" timestamp with time zone,
	"replaced_by" uuid,
	"reason" varchar(1000),
	CONSTRAINT "item_inventory_number_history_value_check" CHECK (btrim("yu_inventory"."item_inventory_number_history"."value") <> '' AND btrim("yu_inventory"."item_inventory_number_history"."comparison_key") <> ''),
	CONSTRAINT "item_inventory_number_history_replacement_check" CHECK ((
            "yu_inventory"."item_inventory_number_history"."replaced_at" IS NULL
            AND "yu_inventory"."item_inventory_number_history"."replaced_by" IS NULL
            AND "yu_inventory"."item_inventory_number_history"."reason" IS NULL
          ) OR (
            "yu_inventory"."item_inventory_number_history"."replaced_at" IS NOT NULL
            AND "yu_inventory"."item_inventory_number_history"."replaced_by" IS NOT NULL
            AND "yu_inventory"."item_inventory_number_history"."replaced_at" >= "yu_inventory"."item_inventory_number_history"."assigned_at"
            AND "yu_inventory"."item_inventory_number_history"."reason" IS NOT NULL
            AND btrim("yu_inventory"."item_inventory_number_history"."reason") <> ''
          ))
);
--> statement-breakpoint
CREATE TABLE "yu_inventory"."item_result_revisions" (
	"result_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"result" "yu_inventory"."item_result_value" NOT NULL,
	"inspection_room_id" uuid NOT NULL,
	"observed_room_id" uuid NOT NULL,
	"comment" varchar(1000),
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"administrative_reason" varchar(1000),
	CONSTRAINT "item_result_revisions_pk" PRIMARY KEY("result_id","revision_number"),
	CONSTRAINT "item_result_revisions_number_check" CHECK ("yu_inventory"."item_result_revisions"."revision_number" > 0),
	CONSTRAINT "item_result_revisions_comment_check" CHECK ("yu_inventory"."item_result_revisions"."comment" IS NULL OR btrim("yu_inventory"."item_result_revisions"."comment") <> '')
);
--> statement-breakpoint
CREATE TABLE "yu_inventory"."item_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"inspection_id" uuid NOT NULL,
	"inspection_room_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"registry_room_id_at_scan" uuid NOT NULL,
	"responsible_id_at_scan" uuid,
	"decision_recipient_kind_at_scan" "yu_inventory"."decision_recipient_kind" NOT NULL,
	"item_name_snapshot" varchar(160) NOT NULL,
	"inventory_number_kind_snapshot" "yu_inventory"."inventory_number_kind" NOT NULL,
	"inventory_number_snapshot" varchar(64) NOT NULL,
	"building_name_snapshot" varchar(120) NOT NULL,
	"room_designation_snapshot" varchar(80) NOT NULL,
	"is_new_item" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_results_id_inspection_room_unique" UNIQUE("id","inspection_room_id"),
	CONSTRAINT "item_results_id_recipient_kind_unique" UNIQUE("id","decision_recipient_kind_at_scan"),
	CONSTRAINT "item_results_id_responsible_unique" UNIQUE("id","responsible_id_at_scan"),
	CONSTRAINT "item_results_snapshot_check" CHECK (btrim("yu_inventory"."item_results"."item_name_snapshot") <> ''
          AND btrim("yu_inventory"."item_results"."inventory_number_snapshot") <> ''
          AND btrim("yu_inventory"."item_results"."building_name_snapshot") <> ''
          AND btrim("yu_inventory"."item_results"."room_designation_snapshot") <> ''),
	CONSTRAINT "item_results_recipient_snapshot_check" CHECK ((
            "yu_inventory"."item_results"."decision_recipient_kind_at_scan" = 'user'
            AND "yu_inventory"."item_results"."responsible_id_at_scan" IS NOT NULL
          ) OR (
            "yu_inventory"."item_results"."decision_recipient_kind_at_scan" = 'admin_queue'
            AND "yu_inventory"."item_results"."responsible_id_at_scan" IS NULL
          ))
);
--> statement-breakpoint
CREATE TABLE "yu_inventory"."items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text,
	"room_id" uuid NOT NULL,
	"inventory_number_kind" "yu_inventory"."inventory_number_kind" NOT NULL,
	"inventory_number" varchar(64) NOT NULL,
	"inventory_number_key" text NOT NULL,
	"status" "yu_inventory"."item_status" DEFAULT 'active' NOT NULL,
	"created_in_inspection_id" uuid,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	CONSTRAINT "items_display_values_check" CHECK (btrim("yu_inventory"."items"."name") <> ''
          AND ("yu_inventory"."items"."description" IS NULL OR btrim("yu_inventory"."items"."description") <> '')
          AND btrim("yu_inventory"."items"."inventory_number") <> ''
          AND btrim("yu_inventory"."items"."inventory_number_key") <> ''),
	CONSTRAINT "items_archive_state_check" CHECK (("yu_inventory"."items"."archived_at" IS NULL) = ("yu_inventory"."items"."archived_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "yu_inventory"."notification_deliveries" (
	"event_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"mailbox_sequence" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "notification_deliveries_pk" PRIMARY KEY("event_id","recipient_id"),
	CONSTRAINT "notification_deliveries_sequence_check" CHECK ("yu_inventory"."notification_deliveries"."mailbox_sequence" > 0)
);
--> statement-breakpoint
CREATE TABLE "yu_inventory"."notification_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"domain_event_id" uuid NOT NULL,
	"type" "yu_inventory"."notification_event_type" NOT NULL,
	"actor_id" uuid,
	"subject_kind" "yu_inventory"."notification_subject_kind" NOT NULL,
	"subject_id" uuid NOT NULL,
	"subject_revision" integer NOT NULL,
	"audience_kind" "yu_inventory"."notification_audience_kind" NOT NULL,
	"safe_payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"admin_queue_sequence" bigint,
	CONSTRAINT "notification_events_subject_revision_check" CHECK ("yu_inventory"."notification_events"."subject_revision" > 0),
	CONSTRAINT "notification_events_audience_sequence_check" CHECK ((
            "yu_inventory"."notification_events"."audience_kind" = 'direct_user'
            AND "yu_inventory"."notification_events"."admin_queue_sequence" IS NULL
          ) OR (
            "yu_inventory"."notification_events"."audience_kind" = 'admin_queue'
            AND "yu_inventory"."notification_events"."admin_queue_sequence" IS NOT NULL
            AND "yu_inventory"."notification_events"."admin_queue_sequence" > 0
          ))
);
--> statement-breakpoint
CREATE TABLE "yu_inventory"."notification_mailboxes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "yu_inventory"."notification_mailbox_kind" NOT NULL,
	"user_id" uuid,
	"next_sequence" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "notification_mailboxes_owner_check" CHECK (("yu_inventory"."notification_mailboxes"."kind" = 'direct_user' AND "yu_inventory"."notification_mailboxes"."user_id" IS NOT NULL)
          OR ("yu_inventory"."notification_mailboxes"."kind" = 'admin_queue' AND "yu_inventory"."notification_mailboxes"."user_id" IS NULL)),
	CONSTRAINT "notification_mailboxes_sequence_check" CHECK ("yu_inventory"."notification_mailboxes"."next_sequence" > 0)
);
--> statement-breakpoint
CREATE TABLE "yu_inventory"."notification_receipts" (
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_receipts_pk" PRIMARY KEY("event_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "yu_inventory"."photos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"purpose" "yu_inventory"."photo_purpose" NOT NULL,
	"status" "yu_inventory"."photo_status" DEFAULT 'reserved' NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"original_object_key" varchar(1024) NOT NULL,
	"preview_object_key" varchar(1024),
	"trusted_mime_type" varchar(32),
	"byte_size" integer,
	"width" integer,
	"height" integer,
	"checksum_sha256" varchar(64),
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attached_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"binary_deleted_at" timestamp with time zone,
	"item_id" uuid,
	"result_id" uuid,
	"result_revision_number" integer,
	"decision_id" uuid,
	CONSTRAINT "photos_object_keys_check" CHECK (btrim("yu_inventory"."photos"."original_object_key") <> ''
          AND (
            "yu_inventory"."photos"."preview_object_key" IS NULL
            OR btrim("yu_inventory"."photos"."preview_object_key") <> ''
          )),
	CONSTRAINT "photos_media_type_check" CHECK ("yu_inventory"."photos"."trusted_mime_type" IS NULL
          OR "yu_inventory"."photos"."trusted_mime_type" IN ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "photos_size_check" CHECK ("yu_inventory"."photos"."byte_size" IS NULL
          OR "yu_inventory"."photos"."byte_size" BETWEEN 1 AND 10485760),
	CONSTRAINT "photos_dimensions_check" CHECK ((
            "yu_inventory"."photos"."width" IS NULL
            AND "yu_inventory"."photos"."height" IS NULL
          ) OR (
            "yu_inventory"."photos"."width" IS NOT NULL
            AND "yu_inventory"."photos"."height" IS NOT NULL
            AND "yu_inventory"."photos"."width" BETWEEN 1 AND 8192
            AND "yu_inventory"."photos"."height" BETWEEN 1 AND 8192
            AND "yu_inventory"."photos"."width"::bigint * "yu_inventory"."photos"."height"::bigint <= 20000000
          )),
	CONSTRAINT "photos_checksum_check" CHECK ("yu_inventory"."photos"."checksum_sha256" IS NULL
          OR "yu_inventory"."photos"."checksum_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "photos_expiration_check" CHECK ("yu_inventory"."photos"."expires_at" > "yu_inventory"."photos"."reserved_at"),
	CONSTRAINT "photos_parent_check" CHECK ((
            "yu_inventory"."photos"."status" IN ('reserved', 'expired')
            AND "yu_inventory"."photos"."item_id" IS NULL
            AND "yu_inventory"."photos"."result_id" IS NULL
            AND "yu_inventory"."photos"."result_revision_number" IS NULL
            AND "yu_inventory"."photos"."decision_id" IS NULL
          ) OR (
            "yu_inventory"."photos"."status" NOT IN ('reserved', 'expired')
            AND (
              (
                "yu_inventory"."photos"."purpose" = 'item'
                AND "yu_inventory"."photos"."item_id" IS NOT NULL
                AND "yu_inventory"."photos"."result_id" IS NULL
                AND "yu_inventory"."photos"."result_revision_number" IS NULL
                AND "yu_inventory"."photos"."decision_id" IS NULL
              ) OR (
                "yu_inventory"."photos"."purpose" = 'inspection_result'
                AND "yu_inventory"."photos"."item_id" IS NULL
                AND "yu_inventory"."photos"."result_id" IS NOT NULL
                AND "yu_inventory"."photos"."result_revision_number" IS NOT NULL
                AND "yu_inventory"."photos"."decision_id" IS NULL
              ) OR (
                "yu_inventory"."photos"."purpose" = 'decision_dispute'
                AND "yu_inventory"."photos"."item_id" IS NULL
                AND "yu_inventory"."photos"."result_id" IS NULL
                AND "yu_inventory"."photos"."result_revision_number" IS NULL
                AND "yu_inventory"."photos"."decision_id" IS NOT NULL
              )
            )
          )),
	CONSTRAINT "photos_attached_metadata_check" CHECK ("yu_inventory"."photos"."status" IN ('reserved', 'expired')
          OR (
            "yu_inventory"."photos"."preview_object_key" IS NOT NULL
            AND "yu_inventory"."photos"."trusted_mime_type" IS NOT NULL
            AND "yu_inventory"."photos"."byte_size" IS NOT NULL
            AND "yu_inventory"."photos"."width" IS NOT NULL
            AND "yu_inventory"."photos"."height" IS NOT NULL
            AND "yu_inventory"."photos"."checksum_sha256" IS NOT NULL
          )),
	CONSTRAINT "photos_lifecycle_check" CHECK ((
            "yu_inventory"."photos"."status" = 'reserved'
            AND "yu_inventory"."photos"."attached_at" IS NULL
            AND "yu_inventory"."photos"."superseded_at" IS NULL
            AND "yu_inventory"."photos"."removed_at" IS NULL
            AND "yu_inventory"."photos"."binary_deleted_at" IS NULL
          ) OR (
            "yu_inventory"."photos"."status" = 'expired'
            AND "yu_inventory"."photos"."attached_at" IS NULL
            AND "yu_inventory"."photos"."superseded_at" IS NULL
            AND "yu_inventory"."photos"."removed_at" IS NULL
          ) OR (
            "yu_inventory"."photos"."status" = 'attached'
            AND "yu_inventory"."photos"."attached_at" IS NOT NULL
            AND "yu_inventory"."photos"."superseded_at" IS NULL
            AND "yu_inventory"."photos"."removed_at" IS NULL
            AND "yu_inventory"."photos"."binary_deleted_at" IS NULL
          ) OR (
            "yu_inventory"."photos"."status" = 'superseded'
            AND "yu_inventory"."photos"."attached_at" IS NOT NULL
            AND "yu_inventory"."photos"."superseded_at" IS NOT NULL
            AND "yu_inventory"."photos"."removed_at" IS NULL
            AND "yu_inventory"."photos"."binary_deleted_at" IS NULL
          ) OR (
            "yu_inventory"."photos"."status" = 'removed'
            AND "yu_inventory"."photos"."attached_at" IS NOT NULL
            AND "yu_inventory"."photos"."superseded_at" IS NULL
            AND "yu_inventory"."photos"."removed_at" IS NOT NULL
            AND "yu_inventory"."photos"."binary_deleted_at" IS NULL
          ) OR (
            "yu_inventory"."photos"."status" = 'purged'
            AND "yu_inventory"."photos"."attached_at" IS NOT NULL
            AND "yu_inventory"."photos"."binary_deleted_at" IS NOT NULL
            AND num_nonnulls("yu_inventory"."photos"."superseded_at", "yu_inventory"."photos"."removed_at") = 1
          )),
	CONSTRAINT "photos_time_order_check" CHECK ((
            "yu_inventory"."photos"."attached_at" IS NULL
            OR (
              "yu_inventory"."photos"."attached_at" >= "yu_inventory"."photos"."reserved_at"
              AND "yu_inventory"."photos"."attached_at" <= "yu_inventory"."photos"."expires_at"
            )
          )
          AND (
            "yu_inventory"."photos"."superseded_at" IS NULL
            OR (
              "yu_inventory"."photos"."attached_at" IS NOT NULL
              AND "yu_inventory"."photos"."superseded_at" >= "yu_inventory"."photos"."attached_at"
            )
          )
          AND (
            "yu_inventory"."photos"."removed_at" IS NULL
            OR (
              "yu_inventory"."photos"."attached_at" IS NOT NULL
              AND "yu_inventory"."photos"."removed_at" >= "yu_inventory"."photos"."attached_at"
            )
          )
          AND (
            "yu_inventory"."photos"."binary_deleted_at" IS NULL
            OR "yu_inventory"."photos"."binary_deleted_at" >= coalesce(
              "yu_inventory"."photos"."superseded_at",
              "yu_inventory"."photos"."removed_at",
              "yu_inventory"."photos"."attached_at",
              "yu_inventory"."photos"."expires_at"
            )
          ))
);
--> statement-breakpoint
CREATE TABLE "yu_inventory"."qr_identifiers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"original_value" text NOT NULL,
	"canonical_key" text NOT NULL,
	"format" "yu_inventory"."qr_format" NOT NULL,
	"target_kind" "yu_inventory"."qr_target_kind" NOT NULL,
	"role" "yu_inventory"."qr_role" NOT NULL,
	"status" "yu_inventory"."qr_status" DEFAULT 'active' NOT NULL,
	"building_id" uuid,
	"room_id" uuid,
	"item_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoke_reason" varchar(1000),
	CONSTRAINT "qr_identifiers_values_check" CHECK (btrim("yu_inventory"."qr_identifiers"."original_value") <> ''
          AND btrim("yu_inventory"."qr_identifiers"."canonical_key") <> ''
          AND octet_length("yu_inventory"."qr_identifiers"."original_value") <= 512
          AND octet_length("yu_inventory"."qr_identifiers"."canonical_key") <= 512),
	CONSTRAINT "qr_identifiers_target_check" CHECK (num_nonnulls("yu_inventory"."qr_identifiers"."building_id", "yu_inventory"."qr_identifiers"."room_id", "yu_inventory"."qr_identifiers"."item_id") = 1
          AND (
            ("yu_inventory"."qr_identifiers"."target_kind" = 'building' AND "yu_inventory"."qr_identifiers"."building_id" IS NOT NULL)
            OR ("yu_inventory"."qr_identifiers"."target_kind" = 'room' AND "yu_inventory"."qr_identifiers"."room_id" IS NOT NULL)
            OR ("yu_inventory"."qr_identifiers"."target_kind" = 'item' AND "yu_inventory"."qr_identifiers"."item_id" IS NOT NULL)
          )),
	CONSTRAINT "qr_identifiers_revocation_check" CHECK ((
            "yu_inventory"."qr_identifiers"."status" = 'active'
            AND "yu_inventory"."qr_identifiers"."revoked_by" IS NULL
            AND "yu_inventory"."qr_identifiers"."revoked_at" IS NULL
            AND "yu_inventory"."qr_identifiers"."revoke_reason" IS NULL
          ) OR (
            "yu_inventory"."qr_identifiers"."status" = 'revoked'
            AND "yu_inventory"."qr_identifiers"."revoked_by" IS NOT NULL
            AND "yu_inventory"."qr_identifiers"."revoked_at" IS NOT NULL
            AND "yu_inventory"."qr_identifiers"."revoke_reason" IS NOT NULL
            AND btrim("yu_inventory"."qr_identifiers"."revoke_reason") <> ''
          )),
	CONSTRAINT "qr_identifiers_generated_format_check" CHECK ("yu_inventory"."qr_identifiers"."format" <> 'generated_v1'
          OR (
            "yu_inventory"."qr_identifiers"."role" = 'primary'
            AND "yu_inventory"."qr_identifiers"."canonical_key" ~ '^YUQ1:[0-9A-HJKMNP-TV-Z]{26}$'
          ))
);
--> statement-breakpoint
CREATE TABLE "yu_inventory"."responsibility_periods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"responsible_user_id" uuid NOT NULL,
	"source" "yu_inventory"."responsibility_source" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_by" uuid NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" uuid,
	"end_reason" varchar(1000),
	CONSTRAINT "responsibility_periods_end_state_check" CHECK ((
            "yu_inventory"."responsibility_periods"."ended_at" IS NULL
            AND "yu_inventory"."responsibility_periods"."ended_by" IS NULL
            AND "yu_inventory"."responsibility_periods"."end_reason" IS NULL
          ) OR (
            "yu_inventory"."responsibility_periods"."ended_at" IS NOT NULL
            AND "yu_inventory"."responsibility_periods"."ended_by" IS NOT NULL
            AND "yu_inventory"."responsibility_periods"."ended_at" >= "yu_inventory"."responsibility_periods"."started_at"
            AND "yu_inventory"."responsibility_periods"."end_reason" IS NOT NULL
            AND btrim("yu_inventory"."responsibility_periods"."end_reason") <> ''
          ))
);
--> statement-breakpoint
CREATE TABLE "yu_inventory"."rooms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"building_id" uuid NOT NULL,
	"designation" varchar(80) NOT NULL,
	"designation_key" text NOT NULL,
	"floor_number" integer NOT NULL,
	"floor_label" varchar(40),
	"status" "yu_inventory"."record_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "rooms_id_building_unique" UNIQUE("id","building_id"),
	CONSTRAINT "rooms_display_values_check" CHECK (btrim("yu_inventory"."rooms"."designation") <> '' AND btrim("yu_inventory"."rooms"."designation_key") <> ''
          AND ("yu_inventory"."rooms"."floor_label" IS NULL OR btrim("yu_inventory"."rooms"."floor_label") <> '')),
	CONSTRAINT "rooms_floor_number_check" CHECK ("yu_inventory"."rooms"."floor_number" BETWEEN -5 AND 200),
	CONSTRAINT "rooms_archive_state_check" CHECK (("yu_inventory"."rooms"."status" = 'active' AND "yu_inventory"."rooms"."archived_at" IS NULL AND "yu_inventory"."rooms"."archived_by" IS NULL)
          OR ("yu_inventory"."rooms"."status" = 'archived' AND "yu_inventory"."rooms"."archived_at" IS NOT NULL AND "yu_inventory"."rooms"."archived_by" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "yu_inventory"."transfers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"proposed_responsible_id" uuid NOT NULL,
	"current_responsible_id_at_request" uuid NOT NULL,
	"status" "yu_inventory"."transfer_status" DEFAULT 'pending_current_owner' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"decision_comment" varchar(1000),
	"administrative_reason" varchar(1000),
	"override_responsible_id" uuid,
	CONSTRAINT "transfers_requester_is_proposed_check" CHECK ("yu_inventory"."transfers"."requested_by" = "yu_inventory"."transfers"."proposed_responsible_id"),
	CONSTRAINT "transfers_distinct_responsible_users_check" CHECK ("yu_inventory"."transfers"."proposed_responsible_id" <> "yu_inventory"."transfers"."current_responsible_id_at_request"),
	CONSTRAINT "transfers_state_check" CHECK ((
            "yu_inventory"."transfers"."status" = 'pending_current_owner'
            AND "yu_inventory"."transfers"."closed_at" IS NULL
            AND "yu_inventory"."transfers"."closed_by" IS NULL
            AND "yu_inventory"."transfers"."decision_comment" IS NULL
            AND "yu_inventory"."transfers"."administrative_reason" IS NULL
            AND "yu_inventory"."transfers"."override_responsible_id" IS NULL
          ) OR (
            "yu_inventory"."transfers"."status" <> 'pending_current_owner'
            AND "yu_inventory"."transfers"."closed_at" IS NOT NULL
            AND "yu_inventory"."transfers"."closed_by" IS NOT NULL
          )),
	CONSTRAINT "transfers_closure_actor_check" CHECK ("yu_inventory"."transfers"."status" = 'pending_current_owner'
          OR (
            "yu_inventory"."transfers"."status" IN ('confirmed', 'rejected')
            AND "yu_inventory"."transfers"."closed_by" = "yu_inventory"."transfers"."current_responsible_id_at_request"
          ) OR (
            "yu_inventory"."transfers"."status" = 'cancelled'
            AND "yu_inventory"."transfers"."closed_by" = "yu_inventory"."transfers"."requested_by"
          ) OR "yu_inventory"."transfers"."status" = 'overridden'),
	CONSTRAINT "transfers_decision_comment_check" CHECK ((
            "yu_inventory"."transfers"."status" = 'rejected'
            AND "yu_inventory"."transfers"."decision_comment" IS NOT NULL
            AND btrim("yu_inventory"."transfers"."decision_comment") <> ''
          ) OR (
            "yu_inventory"."transfers"."status" <> 'rejected'
            AND "yu_inventory"."transfers"."decision_comment" IS NULL
          )),
	CONSTRAINT "transfers_override_state_check" CHECK ((
            "yu_inventory"."transfers"."status" = 'overridden'
            AND "yu_inventory"."transfers"."administrative_reason" IS NOT NULL
            AND btrim("yu_inventory"."transfers"."administrative_reason") <> ''
          ) OR (
            "yu_inventory"."transfers"."status" <> 'overridden'
            AND "yu_inventory"."transfers"."administrative_reason" IS NULL
            AND "yu_inventory"."transfers"."override_responsible_id" IS NULL
          ))
);
--> statement-breakpoint
ALTER TABLE "yu_inventory"."audit_records" ADD CONSTRAINT "audit_records_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."buildings" ADD CONSTRAINT "buildings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."buildings" ADD CONSTRAINT "buildings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."buildings" ADD CONSTRAINT "buildings_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."deviation_decisions" ADD CONSTRAINT "deviation_decisions_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."deviation_decisions" ADD CONSTRAINT "deviation_decisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."deviation_decisions" ADD CONSTRAINT "deviation_decisions_acted_by_users_id_fk" FOREIGN KEY ("acted_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."deviation_decisions" ADD CONSTRAINT "deviation_decisions_result_revision_fk" FOREIGN KEY ("result_id","result_revision_number") REFERENCES "yu_inventory"."item_result_revisions"("result_id","revision_number") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."deviation_decisions" ADD CONSTRAINT "deviation_decisions_previous_result_fk" FOREIGN KEY ("previous_decision_id","result_id") REFERENCES "yu_inventory"."deviation_decisions"("id","result_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."deviation_decisions" ADD CONSTRAINT "deviation_decisions_recipient_kind_snapshot_fk" FOREIGN KEY ("result_id","recipient_kind") REFERENCES "yu_inventory"."item_results"("id","decision_recipient_kind_at_scan") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."deviation_decisions" ADD CONSTRAINT "deviation_decisions_recipient_user_snapshot_fk" FOREIGN KEY ("result_id","recipient_id") REFERENCES "yu_inventory"."item_results"("id","responsible_id_at_scan") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."inspection_room_items" ADD CONSTRAINT "inspection_room_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."inspection_room_items" ADD CONSTRAINT "inspection_room_items_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."inspection_room_items" ADD CONSTRAINT "inspection_room_items_room_context_fk" FOREIGN KEY ("inspection_room_id","registry_room_id") REFERENCES "yu_inventory"."inspection_rooms"("id","room_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."inspection_rooms" ADD CONSTRAINT "inspection_rooms_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "yu_inventory"."inspections"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."inspection_rooms" ADD CONSTRAINT "inspection_rooms_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "yu_inventory"."buildings"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."inspection_rooms" ADD CONSTRAINT "inspection_rooms_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."inspection_rooms" ADD CONSTRAINT "inspection_rooms_inspected_by_users_id_fk" FOREIGN KEY ("inspected_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."inspection_rooms" ADD CONSTRAINT "inspection_rooms_room_building_fk" FOREIGN KEY ("room_id","building_id") REFERENCES "yu_inventory"."rooms"("id","building_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."inspections" ADD CONSTRAINT "inspections_technician_id_users_id_fk" FOREIGN KEY ("technician_id") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."inspections" ADD CONSTRAINT "inspections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."inspections" ADD CONSTRAINT "inspections_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."item_inventory_number_history" ADD CONSTRAINT "item_inventory_number_history_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."item_inventory_number_history" ADD CONSTRAINT "item_inventory_number_history_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."item_inventory_number_history" ADD CONSTRAINT "item_inventory_number_history_replaced_by_users_id_fk" FOREIGN KEY ("replaced_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."item_result_revisions" ADD CONSTRAINT "item_result_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."item_result_revisions" ADD CONSTRAINT "item_result_revisions_result_context_fk" FOREIGN KEY ("result_id","inspection_room_id") REFERENCES "yu_inventory"."item_results"("id","inspection_room_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."item_result_revisions" ADD CONSTRAINT "item_result_revisions_observed_room_context_fk" FOREIGN KEY ("inspection_room_id","observed_room_id") REFERENCES "yu_inventory"."inspection_rooms"("id","room_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."item_results" ADD CONSTRAINT "item_results_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."item_results" ADD CONSTRAINT "item_results_registry_room_id_at_scan_rooms_id_fk" FOREIGN KEY ("registry_room_id_at_scan") REFERENCES "yu_inventory"."rooms"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."item_results" ADD CONSTRAINT "item_results_responsible_id_at_scan_users_id_fk" FOREIGN KEY ("responsible_id_at_scan") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."item_results" ADD CONSTRAINT "item_results_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."item_results" ADD CONSTRAINT "item_results_inspection_room_context_fk" FOREIGN KEY ("inspection_room_id","inspection_id") REFERENCES "yu_inventory"."inspection_rooms"("id","inspection_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."items" ADD CONSTRAINT "items_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "yu_inventory"."rooms"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."items" ADD CONSTRAINT "items_created_in_inspection_id_inspections_id_fk" FOREIGN KEY ("created_in_inspection_id") REFERENCES "yu_inventory"."inspections"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."items" ADD CONSTRAINT "items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."items" ADD CONSTRAINT "items_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."items" ADD CONSTRAINT "items_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."notification_deliveries" ADD CONSTRAINT "notification_deliveries_event_id_notification_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "yu_inventory"."notification_events"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."notification_deliveries" ADD CONSTRAINT "notification_deliveries_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."notification_events" ADD CONSTRAINT "notification_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."notification_mailboxes" ADD CONSTRAINT "notification_mailboxes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."notification_receipts" ADD CONSTRAINT "notification_receipts_event_id_notification_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "yu_inventory"."notification_events"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."notification_receipts" ADD CONSTRAINT "notification_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."photos" ADD CONSTRAINT "photos_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."photos" ADD CONSTRAINT "photos_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."photos" ADD CONSTRAINT "photos_decision_id_deviation_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "yu_inventory"."deviation_decisions"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."photos" ADD CONSTRAINT "photos_result_revision_fk" FOREIGN KEY ("result_id","result_revision_number") REFERENCES "yu_inventory"."item_result_revisions"("result_id","revision_number") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."qr_identifiers" ADD CONSTRAINT "qr_identifiers_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "yu_inventory"."buildings"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."qr_identifiers" ADD CONSTRAINT "qr_identifiers_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "yu_inventory"."rooms"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."qr_identifiers" ADD CONSTRAINT "qr_identifiers_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."qr_identifiers" ADD CONSTRAINT "qr_identifiers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."qr_identifiers" ADD CONSTRAINT "qr_identifiers_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."responsibility_periods" ADD CONSTRAINT "responsibility_periods_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."responsibility_periods" ADD CONSTRAINT "responsibility_periods_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."responsibility_periods" ADD CONSTRAINT "responsibility_periods_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."responsibility_periods" ADD CONSTRAINT "responsibility_periods_ended_by_users_id_fk" FOREIGN KEY ("ended_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."rooms" ADD CONSTRAINT "rooms_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "yu_inventory"."buildings"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."rooms" ADD CONSTRAINT "rooms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."rooms" ADD CONSTRAINT "rooms_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."rooms" ADD CONSTRAINT "rooms_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."transfers" ADD CONSTRAINT "transfers_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."transfers" ADD CONSTRAINT "transfers_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."transfers" ADD CONSTRAINT "transfers_proposed_responsible_id_users_id_fk" FOREIGN KEY ("proposed_responsible_id") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."transfers" ADD CONSTRAINT "transfers_current_responsible_id_at_request_users_id_fk" FOREIGN KEY ("current_responsible_id_at_request") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."transfers" ADD CONSTRAINT "transfers_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."transfers" ADD CONSTRAINT "transfers_override_responsible_id_users_id_fk" FOREIGN KEY ("override_responsible_id") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "audit_records_subject_idx" ON "yu_inventory"."audit_records" USING btree ("subject_kind","subject_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_records_actor_idx" ON "yu_inventory"."audit_records" USING btree ("actor_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_records_domain_event_idx" ON "yu_inventory"."audit_records" USING btree ("domain_event_id");--> statement-breakpoint
CREATE INDEX "buildings_status_idx" ON "yu_inventory"."buildings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "buildings_name_address_key_idx" ON "yu_inventory"."buildings" USING btree ("name_key","address_key");--> statement-breakpoint
CREATE INDEX "buildings_created_by_idx" ON "yu_inventory"."buildings" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "buildings_updated_by_idx" ON "yu_inventory"."buildings" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "deviation_decisions_recipient_status_idx" ON "yu_inventory"."deviation_decisions" USING btree ("recipient_id","status");--> statement-breakpoint
CREATE INDEX "deviation_decisions_result_status_idx" ON "yu_inventory"."deviation_decisions" USING btree ("result_id","result_revision_number","status");--> statement-breakpoint
CREATE INDEX "deviation_decisions_status_created_at_idx" ON "yu_inventory"."deviation_decisions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "deviation_decisions_previous_idx" ON "yu_inventory"."deviation_decisions" USING btree ("previous_decision_id");--> statement-breakpoint
CREATE INDEX "deviation_decisions_created_by_idx" ON "yu_inventory"."deviation_decisions" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "inspection_room_items_item_idx" ON "yu_inventory"."inspection_room_items" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "inspection_room_items_registry_room_idx" ON "yu_inventory"."inspection_room_items" USING btree ("registry_room_id");--> statement-breakpoint
CREATE INDEX "inspection_room_items_responsible_user_idx" ON "yu_inventory"."inspection_room_items" USING btree ("responsible_user_id");--> statement-breakpoint
CREATE INDEX "inspection_rooms_inspection_idx" ON "yu_inventory"."inspection_rooms" USING btree ("inspection_id");--> statement-breakpoint
CREATE INDEX "inspection_rooms_room_idx" ON "yu_inventory"."inspection_rooms" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "inspection_rooms_building_idx" ON "yu_inventory"."inspection_rooms" USING btree ("building_id");--> statement-breakpoint
CREATE INDEX "inspection_rooms_added_by_idx" ON "yu_inventory"."inspection_rooms" USING btree ("added_by");--> statement-breakpoint
CREATE INDEX "inspections_technician_status_idx" ON "yu_inventory"."inspections" USING btree ("technician_id","status");--> statement-breakpoint
CREATE INDEX "inspections_status_created_at_idx" ON "yu_inventory"."inspections" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "inspections_created_by_idx" ON "yu_inventory"."inspections" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "item_inventory_number_history_item_idx" ON "yu_inventory"."item_inventory_number_history" USING btree ("item_id","assigned_at");--> statement-breakpoint
CREATE INDEX "item_inventory_number_history_key_idx" ON "yu_inventory"."item_inventory_number_history" USING btree ("comparison_key");--> statement-breakpoint
CREATE INDEX "item_inventory_number_history_assigned_by_idx" ON "yu_inventory"."item_inventory_number_history" USING btree ("assigned_by");--> statement-breakpoint
CREATE INDEX "item_result_revisions_observed_room_idx" ON "yu_inventory"."item_result_revisions" USING btree ("inspection_room_id","observed_room_id");--> statement-breakpoint
CREATE INDEX "item_result_revisions_created_by_idx" ON "yu_inventory"."item_result_revisions" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "item_results_inspection_idx" ON "yu_inventory"."item_results" USING btree ("inspection_id");--> statement-breakpoint
CREATE INDEX "item_results_inspection_room_idx" ON "yu_inventory"."item_results" USING btree ("inspection_room_id");--> statement-breakpoint
CREATE INDEX "item_results_item_idx" ON "yu_inventory"."item_results" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "item_results_responsible_at_scan_idx" ON "yu_inventory"."item_results" USING btree ("responsible_id_at_scan");--> statement-breakpoint
CREATE INDEX "item_results_registry_room_idx" ON "yu_inventory"."item_results" USING btree ("registry_room_id_at_scan");--> statement-breakpoint
CREATE INDEX "items_room_status_idx" ON "yu_inventory"."items" USING btree ("room_id","status");--> statement-breakpoint
CREATE INDEX "items_status_idx" ON "yu_inventory"."items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "items_inventory_number_key_idx" ON "yu_inventory"."items" USING btree ("inventory_number_key");--> statement-breakpoint
CREATE INDEX "items_created_in_inspection_idx" ON "yu_inventory"."items" USING btree ("created_in_inspection_id");--> statement-breakpoint
CREATE INDEX "items_created_by_idx" ON "yu_inventory"."items" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "items_updated_by_idx" ON "yu_inventory"."items" USING btree ("updated_by");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_recipient_sequence_unique" ON "yu_inventory"."notification_deliveries" USING btree ("recipient_id","mailbox_sequence");--> statement-breakpoint
CREATE INDEX "notification_deliveries_recipient_feed_idx" ON "yu_inventory"."notification_deliveries" USING btree ("recipient_id","created_at","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_events_domain_identity_unique" ON "yu_inventory"."notification_events" USING btree ("domain_event_id","type","subject_kind","subject_id","subject_revision","audience_kind");--> statement-breakpoint
CREATE INDEX "notification_events_feed_idx" ON "yu_inventory"."notification_events" USING btree ("occurred_at","id");--> statement-breakpoint
CREATE INDEX "notification_events_admin_queue_idx" ON "yu_inventory"."notification_events" USING btree ("audience_kind","admin_queue_sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_events_admin_queue_sequence_unique" ON "yu_inventory"."notification_events" USING btree ("admin_queue_sequence") WHERE "yu_inventory"."notification_events"."audience_kind" = 'admin_queue';--> statement-breakpoint
CREATE INDEX "notification_events_actor_idx" ON "yu_inventory"."notification_events" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_mailboxes_direct_user_unique" ON "yu_inventory"."notification_mailboxes" USING btree ("user_id") WHERE "yu_inventory"."notification_mailboxes"."kind" = 'direct_user';--> statement-breakpoint
CREATE UNIQUE INDEX "notification_mailboxes_admin_queue_unique" ON "yu_inventory"."notification_mailboxes" USING btree ("kind") WHERE "yu_inventory"."notification_mailboxes"."kind" = 'admin_queue';--> statement-breakpoint
CREATE INDEX "notification_receipts_user_read_idx" ON "yu_inventory"."notification_receipts" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "photos_expiry_status_idx" ON "yu_inventory"."photos" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "photos_item_status_idx" ON "yu_inventory"."photos" USING btree ("item_id","status");--> statement-breakpoint
CREATE INDEX "photos_result_status_idx" ON "yu_inventory"."photos" USING btree ("result_id","result_revision_number","status");--> statement-breakpoint
CREATE INDEX "photos_decision_status_idx" ON "yu_inventory"."photos" USING btree ("decision_id","status");--> statement-breakpoint
CREATE INDEX "photos_uploaded_by_status_idx" ON "yu_inventory"."photos" USING btree ("uploaded_by","status");--> statement-breakpoint
CREATE INDEX "qr_identifiers_canonical_key_idx" ON "yu_inventory"."qr_identifiers" USING btree ("canonical_key");--> statement-breakpoint
CREATE INDEX "qr_identifiers_building_status_idx" ON "yu_inventory"."qr_identifiers" USING btree ("building_id","status");--> statement-breakpoint
CREATE INDEX "qr_identifiers_room_status_idx" ON "yu_inventory"."qr_identifiers" USING btree ("room_id","status");--> statement-breakpoint
CREATE INDEX "qr_identifiers_item_status_idx" ON "yu_inventory"."qr_identifiers" USING btree ("item_id","status");--> statement-breakpoint
CREATE INDEX "qr_identifiers_created_by_idx" ON "yu_inventory"."qr_identifiers" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "responsibility_periods_item_time_idx" ON "yu_inventory"."responsibility_periods" USING btree ("item_id","started_at");--> statement-breakpoint
CREATE INDEX "responsibility_periods_user_open_idx" ON "yu_inventory"."responsibility_periods" USING btree ("responsible_user_id","ended_at");--> statement-breakpoint
CREATE INDEX "responsibility_periods_started_by_idx" ON "yu_inventory"."responsibility_periods" USING btree ("started_by");--> statement-breakpoint
CREATE INDEX "rooms_building_idx" ON "yu_inventory"."rooms" USING btree ("building_id");--> statement-breakpoint
CREATE INDEX "rooms_building_status_idx" ON "yu_inventory"."rooms" USING btree ("building_id","status");--> statement-breakpoint
CREATE INDEX "rooms_lookup_idx" ON "yu_inventory"."rooms" USING btree ("building_id","floor_number","designation_key");--> statement-breakpoint
CREATE INDEX "rooms_created_by_idx" ON "yu_inventory"."rooms" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "rooms_updated_by_idx" ON "yu_inventory"."rooms" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "transfers_item_status_idx" ON "yu_inventory"."transfers" USING btree ("item_id","status");--> statement-breakpoint
CREATE INDEX "transfers_current_owner_status_idx" ON "yu_inventory"."transfers" USING btree ("current_responsible_id_at_request","status");--> statement-breakpoint
CREATE INDEX "transfers_proposed_owner_status_idx" ON "yu_inventory"."transfers" USING btree ("proposed_responsible_id","status");--> statement-breakpoint
CREATE INDEX "transfers_requested_by_idx" ON "yu_inventory"."transfers" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "transfers_override_responsible_idx" ON "yu_inventory"."transfers" USING btree ("override_responsible_id");
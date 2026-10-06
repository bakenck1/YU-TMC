ALTER TYPE "yu_inventory"."audit_actor_role_snapshot" ADD VALUE 'passport_author' BEFORE 'owner';--> statement-breakpoint
ALTER TYPE "yu_inventory"."audit_actor_role_snapshot" ADD VALUE 'passport_reviewer' BEFORE 'owner';--> statement-breakpoint
ALTER TYPE "yu_inventory"."auth_role" ADD VALUE 'passport_author';--> statement-breakpoint
ALTER TYPE "yu_inventory"."auth_role" ADD VALUE 'passport_reviewer';--> statement-breakpoint
ALTER TYPE "yu_inventory"."notification_event_type" ADD VALUE 'passport.submitted' BEFORE 'transfer.requested';--> statement-breakpoint
ALTER TYPE "yu_inventory"."notification_event_type" ADD VALUE 'passport.approved' BEFORE 'transfer.requested';--> statement-breakpoint
ALTER TYPE "yu_inventory"."notification_event_type" ADD VALUE 'passport.rejected' BEFORE 'transfer.requested';--> statement-breakpoint
ALTER TYPE "yu_inventory"."notification_subject_kind" ADD VALUE 'room_passport' BEFORE 'item';--> statement-breakpoint
CREATE TABLE "yu_inventory"."room_passports" (
	"room_id" uuid PRIMARY KEY NOT NULL,
	"status" varchar(24) DEFAULT 'not_started' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"file_id" uuid,
	"file_name" varchar(240),
	"file_size" integer,
	"binary_data" "bytea",
	"uploaded_by" uuid,
	"submitted_by" uuid,
	"rejection_reason" varchar(24),
	"rejection_comment" varchar(1000),
	CONSTRAINT "room_passports_version_check" CHECK ("yu_inventory"."room_passports"."version" >= 0),
	CONSTRAINT "room_passports_status_check" CHECK ("yu_inventory"."room_passports"."status" in ('not_started','in_progress','in_review','needs_correction','approved')),
	CONSTRAINT "room_passports_file_check" CHECK (("yu_inventory"."room_passports"."file_id" is null and "yu_inventory"."room_passports"."file_name" is null and "yu_inventory"."room_passports"."file_size" is null and "yu_inventory"."room_passports"."binary_data" is null and "yu_inventory"."room_passports"."uploaded_by" is null) or ("yu_inventory"."room_passports"."file_id" is not null and "yu_inventory"."room_passports"."file_name" is not null and length("yu_inventory"."room_passports"."file_name") > 0 and "yu_inventory"."room_passports"."file_size" between 1 and 20971520 and "yu_inventory"."room_passports"."binary_data" is not null and octet_length("yu_inventory"."room_passports"."binary_data") = "yu_inventory"."room_passports"."file_size" and "yu_inventory"."room_passports"."uploaded_by" is not null)),
	CONSTRAINT "room_passports_state_check" CHECK (("yu_inventory"."room_passports"."status" <> 'not_started' or "yu_inventory"."room_passports"."file_id" is null) and ("yu_inventory"."room_passports"."status" not in ('in_review','needs_correction','approved') or ("yu_inventory"."room_passports"."file_id" is not null and "yu_inventory"."room_passports"."submitted_by" is not null)) and ("yu_inventory"."room_passports"."status" <> 'needs_correction' or "yu_inventory"."room_passports"."rejection_reason" is not null)),
	CONSTRAINT "room_passports_reason_check" CHECK ("yu_inventory"."room_passports"."rejection_reason" is null or "yu_inventory"."room_passports"."rejection_reason" in ('wrong_room','incomplete','incorrect','unreadable','unsigned','other')),
	CONSTRAINT "room_passports_other_comment_check" CHECK ("yu_inventory"."room_passports"."rejection_reason" is distinct from 'other' or ("yu_inventory"."room_passports"."rejection_comment" is not null and length(trim("yu_inventory"."room_passports"."rejection_comment")) > 0))
);
--> statement-breakpoint
ALTER TABLE "yu_inventory"."room_passports" ADD CONSTRAINT "room_passports_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "yu_inventory"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yu_inventory"."room_passports" ADD CONSTRAINT "room_passports_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yu_inventory"."room_passports" ADD CONSTRAINT "room_passports_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "room_passports_status_idx" ON "yu_inventory"."room_passports" USING btree ("status");
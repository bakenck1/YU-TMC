CREATE TYPE "yu_inventory"."connection_status" AS ENUM('connected', 'disconnected', 'not_applicable');--> statement-breakpoint
CREATE TYPE "yu_inventory"."item_condition" AS ENUM('good', 'needs_attention', 'damaged');--> statement-breakpoint
CREATE TYPE "yu_inventory"."service_request_status" AS ENUM('new', 'in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "yu_inventory"."service_request_type" AS ENUM('not_working', 'not_connected', 'damaged', 'missing');--> statement-breakpoint
ALTER TYPE "yu_inventory"."audit_subject_kind" ADD VALUE 'service_request';--> statement-breakpoint
CREATE TABLE "yu_inventory"."service_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"type" "yu_inventory"."service_request_type" NOT NULL,
	"description" text NOT NULL,
	"status" "yu_inventory"."service_request_status" DEFAULT 'new' NOT NULL,
	"photo_media_type" varchar(32) DEFAULT 'image/jpeg' NOT NULL,
	"photo_byte_size" integer NOT NULL,
	"photo_width" integer NOT NULL,
	"photo_height" integer NOT NULL,
	"photo_binary_data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "service_requests_description_check" CHECK (btrim("yu_inventory"."service_requests"."description") <> ''),
	CONSTRAINT "service_requests_photo_check" CHECK ("yu_inventory"."service_requests"."photo_media_type" = 'image/jpeg'
          AND "yu_inventory"."service_requests"."photo_byte_size" BETWEEN 1 AND 5242880
          AND "yu_inventory"."service_requests"."photo_width" BETWEEN 1 AND 1920
          AND "yu_inventory"."service_requests"."photo_height" BETWEEN 1 AND 1920
          AND "yu_inventory"."service_requests"."photo_width"::bigint * "yu_inventory"."service_requests"."photo_height"::bigint <= 2500000),
	CONSTRAINT "service_requests_completion_check" CHECK (("yu_inventory"."service_requests"."status" = 'completed') = ("yu_inventory"."service_requests"."completed_at" IS NOT NULL)),
	CONSTRAINT "service_requests_version_check" CHECK ("yu_inventory"."service_requests"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "yu_inventory"."items" ADD COLUMN "condition" "yu_inventory"."item_condition" DEFAULT 'good' NOT NULL;--> statement-breakpoint
ALTER TABLE "yu_inventory"."items" ADD COLUMN "connection_status" "yu_inventory"."connection_status" DEFAULT 'not_applicable' NOT NULL;--> statement-breakpoint
ALTER TABLE "yu_inventory"."rooms" ADD COLUMN "primary_responsible_id" uuid;--> statement-breakpoint
ALTER TABLE "yu_inventory"."service_requests" ADD CONSTRAINT "service_requests_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "yu_inventory"."items"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."service_requests" ADD CONSTRAINT "service_requests_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "yu_inventory"."rooms"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."service_requests" ADD CONSTRAINT "service_requests_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "yu_inventory"."service_requests" ADD CONSTRAINT "service_requests_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "service_requests_status_created_idx" ON "yu_inventory"."service_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "service_requests_room_created_idx" ON "yu_inventory"."service_requests" USING btree ("room_id","created_at");--> statement-breakpoint
CREATE INDEX "service_requests_item_created_idx" ON "yu_inventory"."service_requests" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE INDEX "service_requests_author_created_idx" ON "yu_inventory"."service_requests" USING btree ("author_id","created_at");--> statement-breakpoint
ALTER TABLE "yu_inventory"."rooms" ADD CONSTRAINT "rooms_primary_responsible_id_users_id_fk" FOREIGN KEY ("primary_responsible_id") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "rooms_primary_responsible_idx" ON "yu_inventory"."rooms" USING btree ("primary_responsible_id");
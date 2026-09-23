ALTER TABLE "yu_inventory"."service_requests" DROP CONSTRAINT "service_requests_photo_check";--> statement-breakpoint
ALTER TABLE "yu_inventory"."service_requests" ALTER COLUMN "author_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "yu_inventory"."service_requests" ALTER COLUMN "photo_media_type" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "yu_inventory"."service_requests" ALTER COLUMN "photo_media_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "yu_inventory"."service_requests" ALTER COLUMN "photo_byte_size" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "yu_inventory"."service_requests" ALTER COLUMN "photo_width" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "yu_inventory"."service_requests" ALTER COLUMN "photo_height" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "yu_inventory"."service_requests" ALTER COLUMN "photo_binary_data" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "yu_inventory"."service_requests" ALTER COLUMN "updated_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "yu_inventory"."service_requests" ADD COLUMN "source" varchar(16) DEFAULT 'internal' NOT NULL;--> statement-breakpoint
ALTER TABLE "yu_inventory"."service_requests" ADD COLUMN "external_request_id" varchar(128);--> statement-breakpoint
ALTER TABLE "yu_inventory"."service_requests" ADD COLUMN "external_request_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "yu_inventory"."service_requests" ADD COLUMN "reporter_name" varchar(160);--> statement-breakpoint
ALTER TABLE "yu_inventory"."service_requests" ADD COLUMN "requested_action" varchar(24);--> statement-breakpoint
CREATE UNIQUE INDEX "service_requests_dormitory_external_unique" ON "yu_inventory"."service_requests" USING btree ("external_request_id") WHERE "yu_inventory"."service_requests"."source" = 'dormitory';--> statement-breakpoint
ALTER TABLE "yu_inventory"."service_requests" ADD CONSTRAINT "service_requests_photo_check" CHECK ((
            "yu_inventory"."service_requests"."source" = 'internal'
            AND "yu_inventory"."service_requests"."author_id" IS NOT NULL
            AND "yu_inventory"."service_requests"."updated_by" IS NOT NULL
            AND "yu_inventory"."service_requests"."external_request_id" IS NULL
            AND "yu_inventory"."service_requests"."external_request_hash" IS NULL
            AND "yu_inventory"."service_requests"."reporter_name" IS NULL
            AND "yu_inventory"."service_requests"."requested_action" IS NULL
            AND "yu_inventory"."service_requests"."photo_media_type" = 'image/jpeg'
            AND "yu_inventory"."service_requests"."photo_byte_size" BETWEEN 1 AND 5242880
            AND "yu_inventory"."service_requests"."photo_width" BETWEEN 1 AND 1920
            AND "yu_inventory"."service_requests"."photo_height" BETWEEN 1 AND 1920
            AND "yu_inventory"."service_requests"."photo_width"::bigint * "yu_inventory"."service_requests"."photo_height"::bigint <= 2500000
            AND "yu_inventory"."service_requests"."photo_binary_data" IS NOT NULL
          ) OR (
            "yu_inventory"."service_requests"."source" = 'dormitory'
            AND "yu_inventory"."service_requests"."author_id" IS NULL
            AND "yu_inventory"."service_requests"."external_request_id" IS NOT NULL
            AND btrim("yu_inventory"."service_requests"."external_request_id") <> ''
            AND "yu_inventory"."service_requests"."external_request_hash" ~ '^[0-9a-f]{64}$'
            AND "yu_inventory"."service_requests"."reporter_name" IS NOT NULL
            AND btrim("yu_inventory"."service_requests"."reporter_name") <> ''
            AND "yu_inventory"."service_requests"."requested_action" in ('repair', 'damaged', 'missing', 'other')
            AND "yu_inventory"."service_requests"."photo_media_type" IS NULL
            AND "yu_inventory"."service_requests"."photo_byte_size" IS NULL
            AND "yu_inventory"."service_requests"."photo_width" IS NULL
            AND "yu_inventory"."service_requests"."photo_height" IS NULL
            AND "yu_inventory"."service_requests"."photo_binary_data" IS NULL
          ));
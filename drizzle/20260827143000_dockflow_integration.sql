ALTER TABLE "yu_inventory"."users"
  ADD COLUMN "iin" varchar(12);--> statement-breakpoint
ALTER TABLE "yu_inventory"."users"
  ADD CONSTRAINT "users_iin_format_check"
  CHECK ("iin" IS NULL OR "iin" ~ '^[0-9]{12}$');--> statement-breakpoint
CREATE UNIQUE INDEX "users_active_iin_unique"
  ON "yu_inventory"."users" ("iin")
  WHERE "deleted_at" IS NULL AND "iin" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "users_iin_lookup_idx"
  ON "yu_inventory"."users" ("iin");--> statement-breakpoint

CREATE TABLE "yu_inventory"."dockflow_api_keys" (
  "id" uuid PRIMARY KEY,
  "name" varchar(120) NOT NULL,
  "key_prefix" varchar(32) NOT NULL,
  "key_hash" bytea NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'active',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "yu_inventory"."users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "last_used_at" timestamptz,
  "revoked_at" timestamptz,
  "revoked_by" uuid REFERENCES "yu_inventory"."users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "dockflow_api_keys_name_check" CHECK (btrim("name") <> ''),
  CONSTRAINT "dockflow_api_keys_hash_check" CHECK (octet_length("key_hash") = 32),
  CONSTRAINT "dockflow_api_keys_state_check" CHECK (
    ("status" = 'active' AND "revoked_at" IS NULL AND "revoked_by" IS NULL)
    OR ("status" = 'revoked' AND "revoked_at" IS NOT NULL AND "revoked_by" IS NOT NULL)
  )
);--> statement-breakpoint
CREATE UNIQUE INDEX "dockflow_api_keys_single_active_unique"
  ON "yu_inventory"."dockflow_api_keys" ("status") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX "dockflow_api_keys_created_at_idx"
  ON "yu_inventory"."dockflow_api_keys" ("created_at");--> statement-breakpoint

CREATE TABLE "yu_inventory"."dockflow_request_logs" (
  "id" uuid PRIMARY KEY,
  "request_id" uuid NOT NULL UNIQUE,
  "api_key_id" uuid REFERENCES "yu_inventory"."dockflow_api_keys"("id") ON DELETE SET NULL ON UPDATE RESTRICT,
  "key_prefix" varchar(32),
  "result" varchar(64) NOT NULL,
  "http_status" integer NOT NULL CHECK ("http_status" BETWEEN 100 AND 599),
  "duration_ms" integer NOT NULL CHECK ("duration_ms" >= 0),
  "occurred_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX "dockflow_request_logs_occurred_at_idx"
  ON "yu_inventory"."dockflow_request_logs" ("occurred_at");--> statement-breakpoint

CREATE TABLE "yu_inventory"."dockflow_integration_settings" (
  "singleton" boolean PRIMARY KEY DEFAULT true,
  "retention_days" integer NOT NULL DEFAULT 90,
  "include_key_prefix" boolean NOT NULL DEFAULT true,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid REFERENCES "yu_inventory"."users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "dockflow_integration_settings_singleton_check" CHECK ("singleton" = true),
  CONSTRAINT "dockflow_integration_settings_retention_check" CHECK ("retention_days" BETWEEN 1 AND 3650)
);--> statement-breakpoint
INSERT INTO "yu_inventory"."dockflow_integration_settings" ("singleton") VALUES (true);--> statement-breakpoint

CREATE TABLE "yu_inventory"."dockflow_api_key_events" (
  "id" uuid PRIMARY KEY,
  "api_key_id" uuid NOT NULL REFERENCES "yu_inventory"."dockflow_api_keys"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "action" varchar(24) NOT NULL CHECK ("action" IN ('created', 'revoked', 'rotated')),
  "actor_id" uuid NOT NULL REFERENCES "yu_inventory"."users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "occurred_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX "dockflow_api_key_events_key_time_idx"
  ON "yu_inventory"."dockflow_api_key_events" ("api_key_id", "occurred_at");--> statement-breakpoint

CREATE TABLE "yu_inventory"."asset_loss_cases" (
  "id" uuid PRIMARY KEY,
  "employee_id" uuid NOT NULL REFERENCES "yu_inventory"."users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "item_id" uuid NOT NULL REFERENCES "yu_inventory"."items"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "status" varchar(32) NOT NULL DEFAULT 'payment_pending' CHECK ("status" IN ('payment_pending', 'accounting_review', 'rejected', 'closed')),
  "amount" numeric(14,2) NOT NULL CHECK ("amount" >= 0),
  "currency" varchar(3) NOT NULL DEFAULT 'KZT' CHECK ("currency" = 'KZT'),
  "receipt_photo_id" uuid REFERENCES "yu_inventory"."photos"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "submitted_by" uuid REFERENCES "yu_inventory"."users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "submitted_at" timestamptz,
  "reviewed_by" uuid REFERENCES "yu_inventory"."users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "reviewed_at" timestamptz,
  "review_result" varchar(16),
  "review_comment" varchar(1000),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "closed_at" timestamptz
  , CONSTRAINT "asset_loss_cases_state_check" CHECK (
    ("status" = 'payment_pending' AND "receipt_photo_id" IS NULL AND "submitted_by" IS NULL AND "submitted_at" IS NULL AND "reviewed_by" IS NULL AND "reviewed_at" IS NULL AND "review_result" IS NULL AND "review_comment" IS NULL AND "closed_at" IS NULL)
    OR ("status" = 'accounting_review' AND "receipt_photo_id" IS NOT NULL AND "submitted_by" IS NOT NULL AND "submitted_at" IS NOT NULL AND "reviewed_by" IS NULL AND "reviewed_at" IS NULL AND "review_result" IS NULL AND "closed_at" IS NULL)
    OR ("status" = 'rejected' AND "receipt_photo_id" IS NOT NULL AND "submitted_by" IS NOT NULL AND "submitted_at" IS NOT NULL AND "reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL AND "review_result" = 'rejected' AND "closed_at" IS NULL)
    OR ("status" = 'closed' AND "receipt_photo_id" IS NOT NULL AND "submitted_by" IS NOT NULL AND "submitted_at" IS NOT NULL AND "reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL AND "review_result" = 'approved' AND "closed_at" IS NOT NULL)
  )
);--> statement-breakpoint
CREATE INDEX "asset_loss_cases_employee_status_idx"
  ON "yu_inventory"."asset_loss_cases" ("employee_id", "status");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_loss_cases_open_item_unique"
  ON "yu_inventory"."asset_loss_cases" ("item_id") WHERE "status" <> 'closed';--> statement-breakpoint

CREATE TABLE "yu_inventory"."asset_loss_case_events" (
  "id" uuid PRIMARY KEY,
  "loss_case_id" uuid NOT NULL REFERENCES "yu_inventory"."asset_loss_cases"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "from_status" varchar(32),
  "to_status" varchar(32) NOT NULL,
  "actor_id" uuid NOT NULL REFERENCES "yu_inventory"."users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "comment" varchar(1000),
  "occurred_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX "asset_loss_case_events_case_time_idx"
  ON "yu_inventory"."asset_loss_case_events" ("loss_case_id", "occurred_at");

CREATE TABLE IF NOT EXISTS "yu_inventory"."one_c_fixed_asset_inbox" (
  "external_id" text PRIMARY KEY,
  "payload_hash" varchar(64) NOT NULL,
  "payload" jsonb NOT NULL,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "one_c_fixed_asset_inbox_updated_at_idx"
  ON "yu_inventory"."one_c_fixed_asset_inbox" ("updated_at");

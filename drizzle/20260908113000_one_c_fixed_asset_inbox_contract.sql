ALTER TABLE "yu_inventory"."one_c_fixed_asset_inbox"
  ADD CONSTRAINT "one_c_fixed_asset_inbox_payload_hash_check"
  CHECK ("payload_hash" ~ '^[0-9a-f]{64}$');

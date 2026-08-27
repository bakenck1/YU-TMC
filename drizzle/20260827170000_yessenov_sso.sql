ALTER TABLE "yu_inventory"."user_external_identities"
  DROP CONSTRAINT "user_external_identities_provider_check";--> statement-breakpoint
ALTER TABLE "yu_inventory"."user_external_identities"
  ADD CONSTRAINT "user_external_identities_provider_check"
  CHECK ("provider" IN ('google', 'yessenov'));

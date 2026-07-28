CREATE SCHEMA IF NOT EXISTS "yu_inventory";
--> statement-breakpoint
CREATE TABLE "yu_inventory"."__schema_contract" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"deployment_id" text NOT NULL,
	"manifest_hash" varchar(64) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT transaction_timestamp() NOT NULL,
	CONSTRAINT "__schema_contract_singleton_true" CHECK ("singleton"),
	CONSTRAINT "__schema_contract_manifest_hash_length" CHECK (length("manifest_hash") = 64)
);

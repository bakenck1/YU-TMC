CREATE TABLE "yu_inventory"."settings" (
	"id" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_id_check" CHECK ("yu_inventory"."settings"."id" = 'global'),
	CONSTRAINT "settings_version_check" CHECK ("yu_inventory"."settings"."version" > 0)
);--> statement-breakpoint
INSERT INTO "yu_inventory"."settings" ("id", "payload", "version", "updated_at")
VALUES (
	'global',
	'{"organizationName":"YU Inventory","language":"ru","emailNotifications":true,"pushNotifications":false,"maintenanceAlerts":true}'::jsonb,
	1,
	now()
)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "yu_inventory"."prevent_settings_delete"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'The settings singleton cannot be deleted'
    USING ERRCODE = '55006', CONSTRAINT = 'settings_delete_protected';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "settings_delete_protection"
BEFORE DELETE ON "yu_inventory"."settings"
FOR EACH ROW
EXECUTE FUNCTION "yu_inventory"."prevent_settings_delete"();

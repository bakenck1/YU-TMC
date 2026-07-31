CREATE TYPE "yu_inventory"."audit_actor_role_snapshot" AS ENUM('admin', 'warehouse', 'employee', 'owner');--> statement-breakpoint
ALTER TABLE "yu_inventory"."audit_records" ALTER COLUMN "actor_role_snapshot" SET DATA TYPE "yu_inventory"."audit_actor_role_snapshot" USING "actor_role_snapshot"::text::"yu_inventory"."audit_actor_role_snapshot";--> statement-breakpoint
UPDATE "yu_inventory"."users" SET "role" = 'admin' WHERE "role" = 'owner';--> statement-breakpoint
ALTER TABLE "yu_inventory"."users" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "yu_inventory"."auth_role";--> statement-breakpoint
CREATE TYPE "yu_inventory"."auth_role" AS ENUM('admin', 'warehouse', 'employee');--> statement-breakpoint
ALTER TABLE "yu_inventory"."users" ALTER COLUMN "role" SET DATA TYPE "yu_inventory"."auth_role" USING "role"::"yu_inventory"."auth_role";

CREATE SCHEMA IF NOT EXISTS "yu_inventory";
--> statement-breakpoint
CREATE TYPE "yu_inventory"."auth_role" AS ENUM('admin', 'owner', 'warehouse', 'employee');--> statement-breakpoint
CREATE SEQUENCE "yu_inventory"."user_code_sequence" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "yu_inventory"."auth_bootstrap" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"completed_at" timestamp with time zone,
	"first_admin_user_id" uuid,
	CONSTRAINT "auth_bootstrap_singleton_check" CHECK ("yu_inventory"."auth_bootstrap"."singleton" = true),
	CONSTRAINT "auth_bootstrap_completion_check" CHECK (("yu_inventory"."auth_bootstrap"."completed_at" IS NULL) = ("yu_inventory"."auth_bootstrap"."first_admin_user_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "yu_inventory"."user_password_credentials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"algorithm" varchar(16) DEFAULT 'scrypt' NOT NULL,
	"salt" text NOT NULL,
	"hash" text NOT NULL,
	"scrypt_n" integer DEFAULT 16384 NOT NULL,
	"scrypt_r" integer DEFAULT 8 NOT NULL,
	"scrypt_p" integer DEFAULT 1 NOT NULL,
	"key_length" integer DEFAULT 64 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_password_credentials_algorithm_check" CHECK ("yu_inventory"."user_password_credentials"."algorithm" = 'scrypt'),
	CONSTRAINT "user_password_credentials_hash_check" CHECK ("yu_inventory"."user_password_credentials"."hash" ~ '^[0-9a-f]{128}$'),
	CONSTRAINT "user_password_credentials_parameters_check" CHECK ("yu_inventory"."user_password_credentials"."scrypt_n" = 16384 AND "yu_inventory"."user_password_credentials"."scrypt_r" = 8 AND "yu_inventory"."user_password_credentials"."scrypt_p" = 1 AND "yu_inventory"."user_password_credentials"."key_length" = 64)
);
--> statement-breakpoint
CREATE TABLE "yu_inventory"."users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" varchar(32) NOT NULL,
	"email" varchar(254) NOT NULL,
	"full_name" varchar(120) NOT NULL,
	"role" "yu_inventory"."auth_role" NOT NULL,
	"phone" varchar(32),
	"email_verified" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deactivated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_code_unique" UNIQUE("code"),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_email_normalized_check" CHECK ("yu_inventory"."users"."email" = lower(btrim("yu_inventory"."users"."email"))),
	CONSTRAINT "users_version_positive_check" CHECK ("yu_inventory"."users"."version" > 0),
	CONSTRAINT "users_deactivated_state_check" CHECK ("yu_inventory"."users"."is_active" OR "yu_inventory"."users"."deactivated_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "yu_inventory"."auth_bootstrap" ADD CONSTRAINT "auth_bootstrap_first_admin_user_id_users_id_fk" FOREIGN KEY ("first_admin_user_id") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "yu_inventory"."user_password_credentials" ADD CONSTRAINT "user_password_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
INSERT INTO "yu_inventory"."auth_bootstrap" ("singleton") VALUES (true) ON CONFLICT ("singleton") DO NOTHING;

CREATE TABLE "yu_inventory"."user_external_identities" (
	"provider" varchar(32) NOT NULL,
	"subject" varchar(255) NOT NULL,
	"user_id" uuid NOT NULL,
	"email_at_link" varchar(254) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_external_identities_pk" PRIMARY KEY("provider","subject"),
	CONSTRAINT "user_external_identities_provider_user_unique" UNIQUE("provider","user_id"),
	CONSTRAINT "user_external_identities_provider_check" CHECK ("yu_inventory"."user_external_identities"."provider" = 'google'),
	CONSTRAINT "user_external_identities_email_normalized_check" CHECK ("yu_inventory"."user_external_identities"."email_at_link" = lower(btrim("yu_inventory"."user_external_identities"."email_at_link")))
);
--> statement-breakpoint
ALTER TABLE "yu_inventory"."user_external_identities" ADD CONSTRAINT "user_external_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "yu_inventory"."users"("id") ON DELETE cascade ON UPDATE cascade;
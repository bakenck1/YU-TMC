CREATE TABLE "yu_inventory"."whatsapp_delivery_attempts" (
	"session" varchar(80) NOT NULL,
	"ticket" text NOT NULL,
	"kind" varchar(80) NOT NULL,
	"recipient_id" uuid NOT NULL,
	"attempted_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "whatsapp_delivery_attempts_session_ticket_kind_recipient_id_pk" PRIMARY KEY("session","ticket","kind","recipient_id")
);
--> statement-breakpoint
ALTER TABLE "yu_inventory"."whatsapp_delivery_attempts" ADD CONSTRAINT "whatsapp_delivery_attempts_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "yu_inventory"."users"("id") ON DELETE cascade ON UPDATE no action;
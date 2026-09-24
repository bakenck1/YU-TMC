CREATE TABLE "yu_inventory"."whatsapp_notification_attempts" (
	"request_id" uuid NOT NULL,
	"template" varchar(80) NOT NULL,
	"attempted_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "whatsapp_notification_attempts_request_id_template_pk" PRIMARY KEY("request_id","template")
);
--> statement-breakpoint
CREATE TABLE "yu_inventory"."whatsapp_session_limits" (
	"session" varchar(80) PRIMARY KEY NOT NULL,
	"retry_after_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "yu_inventory"."whatsapp_notification_attempts" ADD CONSTRAINT "whatsapp_notification_attempts_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "yu_inventory"."service_requests"("id") ON DELETE cascade ON UPDATE no action;
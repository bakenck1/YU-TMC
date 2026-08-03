CREATE TABLE "yu_inventory"."item_comment_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"comment_id" uuid NOT NULL,
	"file_name" varchar(180) NOT NULL,
	"media_type" varchar(127) NOT NULL,
	"size_bytes" integer NOT NULL,
	"binary_data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_comment_attachments_comment_unique" UNIQUE("comment_id"),
	CONSTRAINT "item_comment_attachments_file_name_check" CHECK (btrim("yu_inventory"."item_comment_attachments"."file_name") <> ''),
	CONSTRAINT "item_comment_attachments_media_type_check" CHECK (btrim("yu_inventory"."item_comment_attachments"."media_type") <> ''),
	CONSTRAINT "item_comment_attachments_size_check" CHECK ("yu_inventory"."item_comment_attachments"."size_bytes" > 0 AND "yu_inventory"."item_comment_attachments"."size_bytes" <= 2097152 AND octet_length("yu_inventory"."item_comment_attachments"."binary_data") = "yu_inventory"."item_comment_attachments"."size_bytes")
);
--> statement-breakpoint
ALTER TABLE "yu_inventory"."item_comment_attachments" ADD CONSTRAINT "item_comment_attachments_comment_id_audit_records_id_fk" FOREIGN KEY ("comment_id") REFERENCES "yu_inventory"."audit_records"("id") ON DELETE cascade ON UPDATE restrict;
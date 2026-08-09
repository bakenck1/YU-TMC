CREATE UNIQUE INDEX IF NOT EXISTS "service_requests_open_item_unique"
ON "yu_inventory"."service_requests" ("item_id")
WHERE "status" IN ('new', 'in_progress');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "yu_inventory"."enforce_service_request_daily_quota"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  request_count bigint;
  byte_count bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.author_id::text, 731001));
  SELECT count(*), coalesce(sum(photo_byte_size), 0)
    INTO request_count, byte_count
    FROM "yu_inventory"."service_requests"
   WHERE author_id = NEW.author_id
     AND created_at >= now() - interval '24 hours';
  IF request_count >= 20 OR byte_count + NEW.photo_byte_size > 52428800 THEN
    RAISE EXCEPTION 'service request daily quota exceeded'
      USING ERRCODE = '23514', CONSTRAINT = 'service_requests_daily_quota';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "service_requests_daily_quota_trigger"
ON "yu_inventory"."service_requests";
--> statement-breakpoint
CREATE TRIGGER "service_requests_daily_quota_trigger"
BEFORE INSERT ON "yu_inventory"."service_requests"
FOR EACH ROW EXECUTE FUNCTION "yu_inventory"."enforce_service_request_daily_quota"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "yu_inventory"."enforce_comment_attachment_daily_quota"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  author uuid;
  byte_count bigint;
BEGIN
  SELECT actor_id INTO author
    FROM "yu_inventory"."audit_records"
   WHERE id = NEW.comment_id;
  IF author IS NULL THEN
    RAISE EXCEPTION 'comment attachment author is required' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(author::text, 731002));
  SELECT coalesce(sum(attachment.size_bytes), 0)
    INTO byte_count
    FROM "yu_inventory"."item_comment_attachments" attachment
    JOIN "yu_inventory"."audit_records" comment
      ON comment.id = attachment.comment_id
   WHERE comment.actor_id = author
     AND attachment.created_at >= now() - interval '24 hours';
  IF byte_count + NEW.size_bytes > 20971520 THEN
    RAISE EXCEPTION 'comment attachment daily quota exceeded'
      USING ERRCODE = '23514', CONSTRAINT = 'item_comment_attachments_daily_quota';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "item_comment_attachments_daily_quota_trigger"
ON "yu_inventory"."item_comment_attachments";
--> statement-breakpoint
CREATE TRIGGER "item_comment_attachments_daily_quota_trigger"
BEFORE INSERT ON "yu_inventory"."item_comment_attachments"
FOR EACH ROW EXECUTE FUNCTION "yu_inventory"."enforce_comment_attachment_daily_quota"();
--> statement-breakpoint
ALTER TABLE "yu_inventory"."user_password_credentials"
DROP CONSTRAINT IF EXISTS "user_password_credentials_parameters_check";
--> statement-breakpoint
ALTER TABLE "yu_inventory"."user_password_credentials"
ALTER COLUMN "scrypt_p" SET DEFAULT 5;
--> statement-breakpoint
ALTER TABLE "yu_inventory"."user_password_credentials"
ADD CONSTRAINT "user_password_credentials_parameters_check"
CHECK ("scrypt_n" = 16384 AND "scrypt_r" = 8 AND "scrypt_p" IN (1, 5) AND "key_length" = 64);
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "yu_inventory"."password_reset_generation_sequence"
START WITH 1 INCREMENT BY 1 MINVALUE 1 CACHE 1;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "yu_inventory"."password_reset_challenges" (
  "id" uuid PRIMARY KEY,
  "email_key" varchar(64) NOT NULL,
  "code_digest" varchar(64) NOT NULL UNIQUE,
  "status" varchar(16) NOT NULL,
  "generation" bigint NOT NULL DEFAULT nextval('"yu_inventory"."password_reset_generation_sequence"'),
  "attempts" integer NOT NULL DEFAULT 0,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "password_reset_challenges_status_check" CHECK ("status" IN ('pending', 'delivered')),
  CONSTRAINT "password_reset_challenges_attempts_check" CHECK ("attempts" BETWEEN 0 AND 5)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_challenges_delivered_email_unique"
ON "yu_inventory"."password_reset_challenges" ("email_key")
WHERE "status" = 'delivered';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "password_reset_challenges_expiry_idx"
ON "yu_inventory"."password_reset_challenges" ("expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "yu_inventory"."security_rate_limits" (
  "namespace" varchar(64) NOT NULL,
  "key_digest" varchar(64) NOT NULL,
  "window_start" timestamptz NOT NULL,
  "count" integer NOT NULL DEFAULT 1,
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "security_rate_limits_pk" PRIMARY KEY ("namespace", "key_digest", "window_start"),
  CONSTRAINT "security_rate_limits_count_check" CHECK ("count" >= 1)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "security_rate_limits_expiry_idx"
ON "yu_inventory"."security_rate_limits" ("expires_at");

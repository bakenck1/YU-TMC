CREATE TABLE "yu_inventory"."inventory_source_audit_rows" (
	"run_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"item_name" text NOT NULL,
	"site_number" text NOT NULL,
	"number_kind" text NOT NULL,
	"item_version" integer NOT NULL,
	"result" varchar(24) NOT NULL,
	"source" varchar(24),
	"one_c_matches" jsonb NOT NULL,
	"excel_matches" jsonb NOT NULL,
	CONSTRAINT "inventory_source_audit_rows_pk" PRIMARY KEY("run_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "yu_inventory"."inventory_source_audit_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"batch_version" integer NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"one_c_registry_sha256" varchar(64) NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"counts" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "yu_inventory"."material_snapshot_rows" (
	"snapshot_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"nomenclature" text NOT NULL,
	"inventory_number" text NOT NULL,
	"number_key" text NOT NULL,
	"ending_balance" text,
	CONSTRAINT "material_snapshot_rows_pk" PRIMARY KEY("snapshot_id","row_number")
);
--> statement-breakpoint
CREATE TABLE "yu_inventory"."material_snapshot_selection" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"selected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"selected_by" uuid NOT NULL,
	CONSTRAINT "material_snapshot_selection_singleton_check" CHECK ("yu_inventory"."material_snapshot_selection"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "yu_inventory"."material_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"byte_size" integer NOT NULL,
	"source_file" "bytea" NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_count" integer NOT NULL,
	"skipped_count" integer NOT NULL,
	CONSTRAINT "material_snapshots_sha256_unique" UNIQUE("sha256"),
	CONSTRAINT "material_snapshots_counts_check" CHECK ("yu_inventory"."material_snapshots"."byte_size" > 0 AND "yu_inventory"."material_snapshots"."accepted_count" >= 0 AND "yu_inventory"."material_snapshots"."skipped_count" >= 0 AND octet_length("yu_inventory"."material_snapshots"."source_file") = "yu_inventory"."material_snapshots"."byte_size")
);
--> statement-breakpoint
ALTER TABLE "yu_inventory"."inventory_source_audit_rows" ADD CONSTRAINT "inventory_source_audit_rows_run_id_inventory_source_audit_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "yu_inventory"."inventory_source_audit_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yu_inventory"."inventory_source_audit_runs" ADD CONSTRAINT "inventory_source_audit_runs_batch_id_one_c_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "yu_inventory"."one_c_import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yu_inventory"."inventory_source_audit_runs" ADD CONSTRAINT "inventory_source_audit_runs_snapshot_id_material_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "yu_inventory"."material_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yu_inventory"."material_snapshot_rows" ADD CONSTRAINT "material_snapshot_rows_snapshot_id_material_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "yu_inventory"."material_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yu_inventory"."material_snapshot_selection" ADD CONSTRAINT "material_snapshot_selection_snapshot_id_material_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "yu_inventory"."material_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yu_inventory"."material_snapshot_selection" ADD CONSTRAINT "material_snapshot_selection_selected_by_users_id_fk" FOREIGN KEY ("selected_by") REFERENCES "yu_inventory"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_source_audit_rows_result_idx" ON "yu_inventory"."inventory_source_audit_rows" USING btree ("run_id","result","source");--> statement-breakpoint
CREATE INDEX "inventory_source_audit_runs_batch_idx" ON "yu_inventory"."inventory_source_audit_runs" USING btree ("batch_id","run_at");--> statement-breakpoint
CREATE INDEX "material_snapshot_rows_number_idx" ON "yu_inventory"."material_snapshot_rows" USING btree ("snapshot_id","number_key");
--> statement-breakpoint
CREATE FUNCTION "yu_inventory"."prevent_material_snapshot_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'material snapshot is immutable' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "material_snapshots_immutable" BEFORE UPDATE OR DELETE ON "yu_inventory"."material_snapshots" FOR EACH ROW EXECUTE FUNCTION "yu_inventory"."prevent_material_snapshot_mutation"();
--> statement-breakpoint
CREATE TRIGGER "material_snapshot_rows_immutable" BEFORE UPDATE OR DELETE ON "yu_inventory"."material_snapshot_rows" FOR EACH ROW EXECUTE FUNCTION "yu_inventory"."prevent_material_snapshot_mutation"();

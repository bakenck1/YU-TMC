CREATE TABLE "yu_inventory"."integration_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "yu_inventory"."integration_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"transaction_id" "xid8" DEFAULT pg_current_xact_id() NOT NULL,
	"entity" varchar(40) NOT NULL,
	"operation" varchar(8) NOT NULL,
	"record_id" uuid NOT NULL,
	"payload" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_events_operation_check" CHECK ("yu_inventory"."integration_events"."operation" in ('upsert', 'delete')),
	CONSTRAINT "integration_events_payload_check" CHECK (("yu_inventory"."integration_events"."operation" = 'delete' and "yu_inventory"."integration_events"."payload" is null) or ("yu_inventory"."integration_events"."operation" = 'upsert' and "yu_inventory"."integration_events"."payload" is not null))
);
--> statement-breakpoint
CREATE INDEX "integration_events_transaction_cursor_idx" ON "yu_inventory"."integration_events" USING btree ("transaction_id","id");
--> statement-breakpoint
CREATE FUNCTION "yu_inventory"."capture_integration_items"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, yu_inventory AS $capture$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO "yu_inventory"."integration_events" (entity, operation, record_id, payload)
    VALUES ('items', 'delete', OLD.id, NULL);
    RETURN OLD;
  END IF;
  INSERT INTO "yu_inventory"."integration_events" (entity, operation, record_id, payload)
  VALUES ('items', 'upsert', NEW.id, jsonb_build_object('id', NEW."id", 'name', NEW."name", 'itemType', NEW."item_type", 'itemSection', NEW."item_section", 'itType', NEW."it_type", 'brand', NEW."brand", 'model', NEW."model", 'quantity', NEW."quantity", 'unitPrice', NEW."unit_price"::text, 'roomId', NEW."room_id", 'inventoryNumber', NEW."inventory_number", 'inventoryNumberKind', NEW."inventory_number_kind", 'status', NEW."status", 'condition', NEW."condition", 'isProject', NEW."is_project", 'createdBy', NEW."created_by", 'updatedBy', NEW."updated_by", 'createdAt', NEW."created_at", 'updatedAt', NEW."updated_at", 'archivedAt', NEW."archived_at", 'version', NEW."version"));
  RETURN NEW;
END;
$capture$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "yu_inventory"."capture_integration_items"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER integration_capture AFTER INSERT OR UPDATE OR DELETE ON "yu_inventory"."items"
FOR EACH ROW EXECUTE FUNCTION "yu_inventory"."capture_integration_items"();

--> statement-breakpoint
CREATE FUNCTION "yu_inventory"."capture_integration_users"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, yu_inventory AS $capture$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO "yu_inventory"."integration_events" (entity, operation, record_id, payload)
    VALUES ('employees', 'delete', OLD.id, NULL);
    RETURN OLD;
  END IF;
  INSERT INTO "yu_inventory"."integration_events" (entity, operation, record_id, payload)
  VALUES ('employees', 'upsert', NEW.id, jsonb_build_object('id', NEW."id", 'fullName', NEW."full_name", 'orgUnit', NEW."org_unit", 'position', NEW."position", 'role', NEW."role", 'isActive', NEW."is_active", 'updatedAt', NEW."updated_at", 'deletedAt', NEW."deleted_at", 'version', NEW."version"));
  RETURN NEW;
END;
$capture$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "yu_inventory"."capture_integration_users"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER integration_capture AFTER INSERT OR UPDATE OR DELETE ON "yu_inventory"."users"
FOR EACH ROW EXECUTE FUNCTION "yu_inventory"."capture_integration_users"();

--> statement-breakpoint
CREATE FUNCTION "yu_inventory"."capture_integration_buildings"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, yu_inventory AS $capture$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO "yu_inventory"."integration_events" (entity, operation, record_id, payload)
    VALUES ('buildings', 'delete', OLD.id, NULL);
    RETURN OLD;
  END IF;
  INSERT INTO "yu_inventory"."integration_events" (entity, operation, record_id, payload)
  VALUES ('buildings', 'upsert', NEW.id, jsonb_build_object('id', NEW."id", 'name', NEW."name", 'address', NEW."address", 'status', NEW."status", 'updatedAt', NEW."updated_at", 'archivedAt', NEW."archived_at", 'version', NEW."version"));
  RETURN NEW;
END;
$capture$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "yu_inventory"."capture_integration_buildings"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER integration_capture AFTER INSERT OR UPDATE OR DELETE ON "yu_inventory"."buildings"
FOR EACH ROW EXECUTE FUNCTION "yu_inventory"."capture_integration_buildings"();

--> statement-breakpoint
CREATE FUNCTION "yu_inventory"."capture_integration_rooms"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, yu_inventory AS $capture$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO "yu_inventory"."integration_events" (entity, operation, record_id, payload)
    VALUES ('rooms', 'delete', OLD.id, NULL);
    RETURN OLD;
  END IF;
  INSERT INTO "yu_inventory"."integration_events" (entity, operation, record_id, payload)
  VALUES ('rooms', 'upsert', NEW.id, jsonb_build_object('id', NEW."id", 'buildingId', NEW."building_id", 'designation', NEW."designation", 'floorNumber', NEW."floor_number", 'floorLabel', NEW."floor_label", 'primaryResponsibleId', NEW."primary_responsible_id", 'status', NEW."status", 'updatedAt', NEW."updated_at", 'archivedAt', NEW."archived_at", 'version', NEW."version"));
  RETURN NEW;
END;
$capture$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "yu_inventory"."capture_integration_rooms"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER integration_capture AFTER INSERT OR UPDATE OR DELETE ON "yu_inventory"."rooms"
FOR EACH ROW EXECUTE FUNCTION "yu_inventory"."capture_integration_rooms"();

--> statement-breakpoint
CREATE FUNCTION "yu_inventory"."capture_integration_responsibility_periods"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, yu_inventory AS $capture$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO "yu_inventory"."integration_events" (entity, operation, record_id, payload)
    VALUES ('responsibilities', 'delete', OLD.id, NULL);
    RETURN OLD;
  END IF;
  INSERT INTO "yu_inventory"."integration_events" (entity, operation, record_id, payload)
  VALUES ('responsibilities', 'upsert', NEW.id, jsonb_build_object('id', NEW."id", 'itemId', NEW."item_id", 'responsibleUserId', NEW."responsible_user_id", 'source', NEW."source", 'startedAt', NEW."started_at", 'startedBy', NEW."started_by", 'endedAt', NEW."ended_at", 'endedBy', NEW."ended_by"));
  RETURN NEW;
END;
$capture$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "yu_inventory"."capture_integration_responsibility_periods"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER integration_capture AFTER INSERT OR UPDATE OR DELETE ON "yu_inventory"."responsibility_periods"
FOR EACH ROW EXECUTE FUNCTION "yu_inventory"."capture_integration_responsibility_periods"();

--> statement-breakpoint
CREATE FUNCTION "yu_inventory"."capture_integration_local_item_groups"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, yu_inventory AS $capture$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO "yu_inventory"."integration_events" (entity, operation, record_id, payload)
    VALUES ('assignments', 'delete', OLD.id, NULL);
    RETURN OLD;
  END IF;
  INSERT INTO "yu_inventory"."integration_events" (entity, operation, record_id, payload)
  VALUES ('assignments', 'upsert', NEW.id, jsonb_build_object('id', NEW."id", 'itemId', NEW."item_id", 'parentGroupId', NEW."parent_group_id", 'barcodeValue', NEW."barcode_value", 'quantity', NEW."quantity", 'responsibleUserId', NEW."responsible_user_id", 'roomId', NEW."room_id", 'previousResponsibleUserId', NEW."previous_responsible_user_id", 'previousRoomId', NEW."previous_room_id", 'createdBy', NEW."created_by", 'createdAt', NEW."created_at", 'transferredAt', NEW."transferred_at", 'status', NEW."status", 'cancelledAt', NEW."cancelled_at", 'cancelledBy', NEW."cancelled_by", 'version', NEW."version"));
  RETURN NEW;
END;
$capture$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "yu_inventory"."capture_integration_local_item_groups"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER integration_capture AFTER INSERT OR UPDATE OR DELETE ON "yu_inventory"."local_item_groups"
FOR EACH ROW EXECUTE FUNCTION "yu_inventory"."capture_integration_local_item_groups"();

--> statement-breakpoint
CREATE FUNCTION "yu_inventory"."capture_integration_transfers"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, yu_inventory AS $capture$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO "yu_inventory"."integration_events" (entity, operation, record_id, payload)
    VALUES ('transfers', 'delete', OLD.id, NULL);
    RETURN OLD;
  END IF;
  INSERT INTO "yu_inventory"."integration_events" (entity, operation, record_id, payload)
  VALUES ('transfers', 'upsert', NEW.id, jsonb_build_object('id', NEW."id", 'itemId', NEW."item_id", 'requestedBy', NEW."requested_by", 'proposedResponsibleId', NEW."proposed_responsible_id", 'currentResponsibleIdAtRequest', NEW."current_responsible_id_at_request", 'status', NEW."status", 'requestedAt', NEW."requested_at", 'closedAt', NEW."closed_at", 'closedBy', NEW."closed_by", 'overrideOutcome', NEW."override_outcome", 'overrideResponsibleId', NEW."override_responsible_id", 'version', NEW."version"));
  RETURN NEW;
END;
$capture$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "yu_inventory"."capture_integration_transfers"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER integration_capture AFTER INSERT OR UPDATE OR DELETE ON "yu_inventory"."transfers"
FOR EACH ROW EXECUTE FUNCTION "yu_inventory"."capture_integration_transfers"();

--> statement-breakpoint
CREATE FUNCTION "yu_inventory"."capture_integration_tmc_transfer_requests"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, yu_inventory AS $capture$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO "yu_inventory"."integration_events" (entity, operation, record_id, payload)
    VALUES ('transfer-requests', 'delete', OLD.id, NULL);
    RETURN OLD;
  END IF;
  INSERT INTO "yu_inventory"."integration_events" (entity, operation, record_id, payload)
  VALUES ('transfer-requests', 'upsert', NEW.id, jsonb_build_object('id', NEW."id", 'initiatorId', NEW."initiator_id", 'recipientId', NEW."recipient_id", 'status', NEW."status", 'createdAt', NEW."created_at", 'expiresAt', NEW."expires_at", 'closedAt', NEW."closed_at", 'closedBy', NEW."closed_by", 'isAdministrativeDecision', NEW."is_administrative_decision", 'version', NEW."version"));
  RETURN NEW;
END;
$capture$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "yu_inventory"."capture_integration_tmc_transfer_requests"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER integration_capture AFTER INSERT OR UPDATE OR DELETE ON "yu_inventory"."tmc_transfer_requests"
FOR EACH ROW EXECUTE FUNCTION "yu_inventory"."capture_integration_tmc_transfer_requests"();

--> statement-breakpoint
CREATE FUNCTION "yu_inventory"."capture_integration_tmc_transfer_request_items"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, yu_inventory AS $capture$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO "yu_inventory"."integration_events" (entity, operation, record_id, payload)
    VALUES ('transfer-request-items', 'delete', OLD.id, NULL);
    RETURN OLD;
  END IF;
  INSERT INTO "yu_inventory"."integration_events" (entity, operation, record_id, payload)
  VALUES ('transfer-request-items', 'upsert', NEW.id, jsonb_build_object('id', NEW."id", 'requestId', NEW."request_id", 'itemId', NEW."item_id", 'currentResponsibleIdAtRequest', NEW."current_responsible_id_at_request", 'responsibilityPeriodIdAtRequest', NEW."responsibility_period_id_at_request", 'requestedQuantity', NEW."requested_quantity", 'sourceLocalGroupId', NEW."source_local_group_id", 'sourceVersion', NEW."source_version", 'result', NEW."result", 'createdAt', NEW."created_at", 'decidedAt', NEW."decided_at", 'decidedBy', NEW."decided_by", 'version', NEW."version"));
  RETURN NEW;
END;
$capture$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "yu_inventory"."capture_integration_tmc_transfer_request_items"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER integration_capture AFTER INSERT OR UPDATE OR DELETE ON "yu_inventory"."tmc_transfer_request_items"
FOR EACH ROW EXECUTE FUNCTION "yu_inventory"."capture_integration_tmc_transfer_request_items"();

--> statement-breakpoint
CREATE FUNCTION "yu_inventory"."capture_integration_service_requests"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, yu_inventory AS $capture$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO "yu_inventory"."integration_events" (entity, operation, record_id, payload)
    VALUES ('service-requests', 'delete', OLD.id, NULL);
    RETURN OLD;
  END IF;
  INSERT INTO "yu_inventory"."integration_events" (entity, operation, record_id, payload)
  VALUES ('service-requests', 'upsert', NEW.id, jsonb_build_object('id', NEW."id", 'itemId', NEW."item_id", 'roomId', NEW."room_id", 'authorId', NEW."author_id", 'type', NEW."type", 'status', NEW."status", 'createdAt', NEW."created_at", 'updatedAt', NEW."updated_at", 'completedAt', NEW."completed_at", 'updatedBy', NEW."updated_by", 'version', NEW."version"));
  RETURN NEW;
END;
$capture$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "yu_inventory"."capture_integration_service_requests"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER integration_capture AFTER INSERT OR UPDATE OR DELETE ON "yu_inventory"."service_requests"
FOR EACH ROW EXECUTE FUNCTION "yu_inventory"."capture_integration_service_requests"();

--> statement-breakpoint
CREATE FUNCTION "yu_inventory"."capture_integration_inspections"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, yu_inventory AS $capture$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO "yu_inventory"."integration_events" (entity, operation, record_id, payload)
    VALUES ('inspections', 'delete', OLD.id, NULL);
    RETURN OLD;
  END IF;
  INSERT INTO "yu_inventory"."integration_events" (entity, operation, record_id, payload)
  VALUES ('inspections', 'upsert', NEW.id, jsonb_build_object('id', NEW."id", 'name', NEW."name", 'technicianId', NEW."technician_id", 'createdBy', NEW."created_by", 'status', NEW."status", 'createdAt', NEW."created_at", 'updatedAt', NEW."updated_at", 'deadlineAt', NEW."deadline_at", 'confirmedAt', NEW."confirmed_at", 'cancelledAt', NEW."cancelled_at", 'version', NEW."version"));
  RETURN NEW;
END;
$capture$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "yu_inventory"."capture_integration_inspections"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER integration_capture AFTER INSERT OR UPDATE OR DELETE ON "yu_inventory"."inspections"
FOR EACH ROW EXECUTE FUNCTION "yu_inventory"."capture_integration_inspections"();

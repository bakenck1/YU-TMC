import "server-only";

import { XMLParser, XMLValidator } from "fast-xml-parser";
import { materialIdentityKey, type OneCMaterial, type OneCMaterialsSnapshot } from "@/lib/contracts/one-c-materials";

export const MAX_ONE_C_MATERIALS_XML_BYTES = 64 * 1024 * 1024;
export const MAX_ONE_C_MATERIALS_RECORDS = 50_000;
export const MAX_ONE_C_MATERIALS_TEXT_LENGTH = 255;
export const MAX_ONE_C_MATERIALS_IDENTIFIER_BYTES = 128;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELDS = new Set(["GUID", "Code", "Name", "AccountCode", "WarehouseGUID", "WarehouseCode", "WarehouseName", "Responsible", "ResponsibleGUID", "ResponsibleCode", "InventoryNumber", "Barcode", "Unit", "Quantity", "UnitPrice", "Currency"]);
const parser = new XMLParser({ ignoreAttributes: false, trimValues: true, parseTagValue: false, processEntities: true });

export class OneCMaterialsContractError extends Error {
  constructor(readonly code: string) { super(code); this.name = "OneCMaterialsContractError"; }
}

export function parseOneCMaterials(xml: string): OneCMaterialsSnapshot {
  if (Buffer.byteLength(xml, "utf8") > MAX_ONE_C_MATERIALS_XML_BYTES) fail("xml_too_large");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail("xml_entities_not_supported");
  if (/<\/?[A-Za-z_][\w.-]*:|\sxmlns(?::[\w.-]+)?\s*=/i.test(xml)) fail("xml_namespaces_not_supported");
  if (XMLValidator.validate(xml, { allowBooleanAttributes: false }) !== true) fail("invalid_xml");
  const document = parser.parse(xml) as Record<string, unknown>;
  if (!Object.hasOwn(document, "Materials") || Object.keys(document).some((key) => !key.startsWith("?") && key !== "Materials")) fail("invalid_root");
  const root = document.Materials;
  if (!isRecord(root) || Object.keys(root).some((key) => !["Material", "SnapshotAt", "SchemaVersion", "ReplaceLegacyBalances"].includes(key))) fail("invalid_root_shape");
  const schemaVersion = text(root, "SchemaVersion") ?? "1";
  if (schemaVersion !== "1" && schemaVersion !== "2") fail("unsupported_schema_version");
  const replaceLegacy = text(root, "ReplaceLegacyBalances");
  if (replaceLegacy !== null && (schemaVersion !== "2" || !["true", "false"].includes(replaceLegacy))) fail("invalid_replace_legacy_balances");
  const snapshotAt = timestamp(text(root, "SnapshotAt"));
  const raw = root.Material;
  const records = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  if (!records.length || records.some((record) => !isRecord(record))) fail("materials_not_found");
  if (records.length > MAX_ONE_C_MATERIALS_RECORDS) fail("too_many_records");
  const materials = records.map((record, index) => normalizeMaterial(record as Record<string, unknown>, index, schemaVersion));
  const identities = new Set<string>();
  const codes = new Map<string, string>();
  const warehouses = new Map<string, string>();
  for (const material of materials) {
    const identity = materialIdentityKey(material);
    if (identities.has(identity)) fail(schemaVersion === "2" ? "duplicate_material_balance" : "duplicate_material_warehouse");
    identities.add(identity);
    // A stable code cannot identify two different objects in one snapshot.
    if (material.externalId) {
      if (codes.has(material.code) && codes.get(material.code) !== material.externalId) fail("conflicting_material_guid");
      codes.set(material.code, material.externalId);
    }
    if (material.warehouseCode && material.warehouseExternalId) {
      if (warehouses.has(material.warehouseCode) && warehouses.get(material.warehouseCode) !== material.warehouseExternalId) fail("conflicting_warehouse_guid");
      warehouses.set(material.warehouseCode, material.warehouseExternalId);
    }
  }
  return { snapshotAt, materials, ...(replaceLegacy === "true" ? { replaceLegacyBalances: true as const } : {}) };
}

function normalizeMaterial(record: Record<string, unknown>, index: number, schemaVersion: string): OneCMaterial {
  const row = index + 1;
  if (Object.keys(record).some((key) => !FIELDS.has(key))) fail(`row_${row}_unsupported_field`);
  const code = text(record, "Code", row);
  const name = text(record, "Name", row);
  if (!code) fail(`row_${row}_code_required`);
  if (!name) fail(`row_${row}_name_required`);
  const quantity = decimal(text(record, "Quantity", row), 3, true, row, "quantity");
  if (quantity === null) fail(`row_${row}_quantity_required`);
  const currency = text(record, "Currency", row) ?? "KZT";
  if (currency !== "KZT") fail(`row_${row}_unsupported_currency`);
  const warehouseExternalId = guid(record, "WarehouseGUID", row);
  const warehouseCode = text(record, "WarehouseCode", row);
  const warehouseName = text(record, "WarehouseName", row);
  const responsibleName = text(record, "Responsible", row);
  const responsibleExternalId = guid(record, "ResponsibleGUID", row);
  const responsibleCode = text(record, "ResponsibleCode", row);
  const accountCode = text(record, "AccountCode", row);
  if (schemaVersion === "2") {
    if (!accountCode) fail(`row_${row}_account_code_required`);
    if (responsibleName && !responsibleCode && !responsibleExternalId) fail(`row_${row}_responsible_identity_required`);
    // Bound compound PostgreSQL btree keys by encoded bytes, not Unicode character count.
    for (const identifier of [code, warehouseCode, accountCode, responsibleCode]) {
      if (identifier && (Buffer.byteLength(identifier, "utf8") > MAX_ONE_C_MATERIALS_IDENTIFIER_BYTES || /[\u0000-\u001f\u007f]/.test(identifier))) {
        fail(`row_${row}_invalid_identifier`);
      }
    }
  } else if (responsibleCode || accountCode) fail(`row_${row}_schema_version_2_required`);
  if (warehouseName && !warehouseCode && !warehouseExternalId) fail(`row_${row}_warehouse_identity_required`);
  return {
    externalId: guid(record, "GUID", row), code, name,
    warehouseExternalId, warehouseCode, warehouseName,
    inventoryNumber: text(record, "InventoryNumber", row), barcode: text(record, "Barcode", row),
    unit: text(record, "Unit", row), quantity,
    unitPrice: decimal(text(record, "UnitPrice", row), 2, false, row, "unit_price"), currency,
    // Do not change hashes of older XML packets that have no responsible-person fields.
    ...(responsibleName ? { responsibleName } : {}),
    ...(responsibleExternalId ? { responsibleExternalId } : {}),
    ...(schemaVersion === "2" ? { balanceSchemaVersion: 2 as const, accountCode: accountCode!, ...(responsibleCode ? { responsibleCode } : {}) } : {}),
  };
}

function text(record: Record<string, unknown>, key: string, row?: number): string | null {
  const value = record[key];
  if (value === undefined) return null;
  if (typeof value !== "string") fail(row ? `row_${row}_invalid_${key.toLowerCase()}` : `invalid_${key.toLowerCase()}`);
  const result = value.trim();
  if (result.length > MAX_ONE_C_MATERIALS_TEXT_LENGTH) fail(row ? `row_${row}_text_too_long` : "text_too_long");
  return result || null;
}

function guid(record: Record<string, unknown>, key: string, row: number): string | null {
  const value = text(record, key, row);
  if (value && !UUID.test(value)) fail(`row_${row}_invalid_${key.toLowerCase()}`);
  return value?.toLowerCase() ?? null;
}

function decimal(value: string | null, scale: number, signed: boolean, row: number, field: string): string | null {
  if (value === null) return null;
  // Thousands separators may be spaces, NBSP or narrow NBSP; decimals use dot or comma.
  const grammar = /^[+-]?(?:\d+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+)(?:[.,]\d+)?$/;
  if (!grammar.test(value)) fail(`row_${row}_invalid_${field}`);
  const normalized = value.replace(/[ \u00a0\u202f]/g, "").replace(",", ".");
  const negative = normalized.startsWith("-");
  const [rawInteger, rawFraction = ""] = normalized.replace(/^[+-]/, "").split(".");
  const integer = rawInteger.replace(/^0+(?=\d)/, "");
  const fraction = rawFraction.replace(/0+$/, "");
  if (integer.length > 18 - scale || fraction.length > scale || (!signed && negative && (integer !== "0" || fraction))) fail(`row_${row}_invalid_${field}`);
  const sign = negative && (integer !== "0" || fraction) ? "-" : "";
  return `${sign}${integer}${fraction ? `.${fraction}` : ""}`;
}

function timestamp(value: string | null): string {
  if (!value) fail("snapshot_at_required");
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/);
  if (!match || Number(value.slice(0, 4)) < 1 || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59 || (match[6] && (Number(match[6]) > 14 || Number(match[7]) > 59 || (Number(match[6]) === 14 && Number(match[7]) !== 0)))) fail("invalid_snapshot_at");
  const calendar = new Date(`${match[1]}T00:00:00Z`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || !Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== match[1]) fail("invalid_snapshot_at");
  return new Date(milliseconds).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function fail(code: string): never { throw new OneCMaterialsContractError(code); }

import "server-only";

import { createHash } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { OneCFixedAsset } from "@/lib/contracts/one-c-fixed-assets";

export type { OneCFixedAsset, OneCImportResult } from "@/lib/contracts/one-c-fixed-assets";

export const MAX_ONE_C_XML_BYTES = 10 * 1024 * 1024;
export const MAX_ONE_C_RECORDS = 5_000;
export const MAX_ONE_C_TEXT_LENGTH = 255;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROOT_NAMES = ["FixedAssets", "FixedAssetsExport"] as const;
const STATUS_ALIASES = new Map([
  ["принято к учёту", "Принято к учёту"], ["принято к учету", "Принято к учёту"],
  ["принят к учёту", "Принято к учёту"], ["принят к учету", "Принято к учёту"],
  ["снято с учёта", "Снято с учёта"], ["снято с учета", "Снято с учёта"],
  ["не в учёте", "Не в учёте"], ["не в учете", "Не в учёте"],
]);
const parser = new XMLParser({ ignoreAttributes: false, trimValues: true, parseTagValue: false, processEntities: false });

export class OneCContractError extends Error {
  constructor(readonly code: string) { super(code); this.name = "OneCContractError"; }
}

export function parseOneCFixedAssets(xml: string): OneCFixedAsset[] {
  if (Buffer.byteLength(xml, "utf8") > MAX_ONE_C_XML_BYTES) fail("xml_too_large");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail("xml_entities_not_supported");
  if (/<\/?[A-Za-z_][\w.-]*:|\sxmlns(?::[\w.-]+)?\s*=/i.test(xml)) fail("xml_namespaces_not_supported");
  if (XMLValidator.validate(xml, { allowBooleanAttributes: false }) !== true) fail("invalid_xml");

  const document = parser.parse(xml) as Record<string, unknown>;
  const roots = ROOT_NAMES.filter((name) => Object.hasOwn(document, name));
  if (roots.length !== 1 || Object.keys(document).some((key) => !key.startsWith("?") && key !== roots[0])) fail("invalid_root");
  const root = document[roots[0]];
  if (root === "") fail("fixed_assets_not_found");
  if (!isRecord(root)) fail("invalid_root");
  if (Object.keys(root).some((key) => key !== "FixedAsset" && !key.startsWith("@_"))) fail("invalid_root_shape");
  const rawRecords = root.FixedAsset;
  const values = Array.isArray(rawRecords) ? rawRecords : rawRecords ? [rawRecords] : [];
  const records = values.filter(isRecord);
  if (!records.length || records.length !== values.length) fail("fixed_assets_not_found");
  if (records.length > MAX_ONE_C_RECORDS) fail("too_many_records");

  const assets = records.map(normalizeAsset);
  const identifiers = new Set<string>();
  for (const asset of assets) {
    const key = asset.externalId.toLowerCase();
    if (identifiers.has(key)) fail("duplicate_external_id");
    identifiers.add(key);
  }
  return assets;
}

export function oneCFixedAssetPayload(asset: OneCFixedAsset) {
  const payload = JSON.stringify(asset);
  return { payload, hash: createHash("sha256").update(payload).digest("hex") };
}

function normalizeAsset(record: Record<string, unknown>, index: number): OneCFixedAsset {
  const externalId = text(record, "ExternalId", "GUID", "Guid", "GUIDОС", "Идентификатор");
  const code = text(record, "Code", "Код");
  const inventoryNumber = text(record, "InventoryNumber", "ИнвентарныйНомер");
  const name = text(record, "Name", "Наименование", "ОсновноеСредство") ?? code;
  if (!externalId || !UUID.test(externalId)) rowFail(index, "invalid_external_id");
  if (!name) rowFail(index, "name_required");
  const responsibleExternalId = text(record, "ResponsibleExternalId", "ResponsibleGUID", "ResponsibleGuid", "GUIDМОЛ");
  if (responsibleExternalId && !UUID.test(responsibleExternalId)) rowFail(index, "invalid_responsible_external_id");
  const rawStatus = text(record, "Status", "Статус");
  const status = rawStatus ? (STATUS_ALIASES.get(rawStatus.toLocaleLowerCase("ru")) ?? null) : null;
  if (rawStatus && !status) rowFail(index, "invalid_status");
  return {
    externalId, code, inventoryNumber, barcode: text(record, "Barcode", "Штрихкод"), name,
    category: text(record, "Category", "Тип", "ГруппаУчетаОС"),
    location: text(record, "Location", "Локация", "Подразделение", "Местонахождение"), status,
    responsibleName: text(record, "ResponsibleName", "Responsible", "МОЛ", "Ответственный", "МатериальноОтветственноеЛицо"),
    responsibleExternalId,
    quantity: numberValue(record, index, "Quantity", "КолВо", "Количество") ?? 1,
    residualCost: numberValue(record, index, "ResidualCost", "ResidualValue", "ЦенаОстаточная", "ОстаточнаяСтоимость", "Цена"),
    acceptedAt: dateValue(record, index, "AcceptedAt", "AcceptanceDate", "ДатаПринятияКУчёту", "ДатаПринятия"),
    updatedAt: dateValue(record, index, "UpdatedAt", "ДатаИзменения", "Изменено"),
  };
}

function text(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    const normalized = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : null;
    if (!normalized) continue;
    if (normalized.length > MAX_ONE_C_TEXT_LENGTH) fail("text_too_long");
    return normalized;
  }
  return null;
}

function numberValue(record: Record<string, unknown>, index: number, ...keys: string[]): number | null {
  const value = text(record, ...keys);
  if (!value) return null;
  const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) rowFail(index, "invalid_number");
  return parsed;
}

function dateValue(record: Record<string, unknown>, index: number, ...keys: string[]): string | null {
  const value = text(record, ...keys);
  if (!value) return null;
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  const normalized = match ? `${match[3]}-${match[2]}-${match[1]}` : value;
  if (!/^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/.test(normalized) || Number.isNaN(Date.parse(normalized))) rowFail(index, "invalid_date");
  const calendarDate = normalized.slice(0, 10);
  if (new Date(`${calendarDate}T00:00:00Z`).toISOString().slice(0, 10) !== calendarDate) rowFail(index, "invalid_date");
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function rowFail(index: number, code: string): never { return fail(`row_${index + 1}_${code}`); }
function fail(code: string): never { throw new OneCContractError(code); }

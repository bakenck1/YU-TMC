import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { XMLParser } from "fast-xml-parser";

import { getDatabasePool } from "@/lib/db/client";

const MAX_XML_BYTES = 10 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
  processEntities: false,
});

export type OneCFixedAsset = {
  externalId: string;
  code: string | null;
  inventoryNumber: string | null;
  barcode: string | null;
  name: string;
  category: string | null;
  location: string | null;
  status: string | null;
  responsibleName: string | null;
  responsibleExternalId: string | null;
  quantity: number;
  residualCost: number | null;
  acceptedAt: string | null;
  updatedAt: string | null;
};

export type OneCImportResult = {
  received: number;
  created: number;
  updated: number;
  unchanged: number;
  errors: Array<{ index: number; externalId?: string; message: string }>;
};

export function authorizeOneCRequest(request: Request): Response | null {
  const expected = process.env.ONE_C_FIXED_ASSETS_API_KEY?.trim();
  if (!expected) return Response.json({ error: "integration_not_configured" }, { status: 503 });
  const value = request.headers.get("authorization")?.match(/^Bearer\s+([^\s]+)$/i)?.[1] ?? "";
  const left = createHash("sha256").update(value).digest();
  const right = createHash("sha256").update(expected).digest();
  if (!timingSafeEqual(left, right)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  }
  return null;
}

export function parseOneCFixedAssets(xml: string): OneCFixedAsset[] {
  if (Buffer.byteLength(xml, "utf8") > MAX_XML_BYTES) throw new Error("xml_too_large");
  const document = parser.parse(xml) as Record<string, unknown>;
  const records = findAssetRecords(document);
  if (!records.length) throw new Error("fixed_assets_not_found");
  return records.map((record, index) => normalizeAsset(record, index));
}

export async function ingestOneCFixedAssets(assets: OneCFixedAsset[]): Promise<OneCImportResult> {
  const pool = getDatabasePool();
  const result: OneCImportResult = { received: assets.length, created: 0, updated: 0, unchanged: 0, errors: [] };
  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index];
    try {
      const payload = JSON.stringify(asset);
      const hash = createHash("sha256").update(payload).digest("hex");
      const existing = await pool.query<{ payload_hash: string }>(
        `select payload_hash from "yu_inventory"."one_c_fixed_asset_inbox" where external_id = $1`,
        [asset.externalId],
      );
      if (existing.rows[0]?.payload_hash === hash) {
        result.unchanged += 1;
        continue;
      }
      await pool.query(
        `insert into "yu_inventory"."one_c_fixed_asset_inbox"
          (external_id, payload_hash, payload, received_at, updated_at)
         values ($1, $2, $3::jsonb, now(), now())
         on conflict (external_id) do update set
           payload_hash = excluded.payload_hash,
           payload = excluded.payload,
           received_at = now(),
           updated_at = now()`,
        [asset.externalId, hash, payload],
      );
      if (existing.rowCount) result.updated += 1;
      else result.created += 1;
    } catch (error) {
      result.errors.push({ index, externalId: asset.externalId, message: error instanceof Error ? error.message : "store_failed" });
    }
  }
  return result;
}

function findAssetRecords(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(findAssetRecords);
  const object = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(object)) {
    if (/^(FixedAsset|FixedAssetsItem|ОсновноеСредство|ОсновныеСредства)$/i.test(key)) {
      const values = Array.isArray(child) ? child : [child];
      return values.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
    }
  }
  for (const child of Object.values(object)) {
    const found = findAssetRecords(child);
    if (found.length) return found;
  }
  return [];
}

function normalizeAsset(record: Record<string, unknown>, index: number): OneCFixedAsset {
  const externalId = text(record, "ExternalId", "GUID", "Guid", "GUIDОС", "Идентификатор");
  const code = text(record, "Code", "Код");
  const inventoryNumber = text(record, "InventoryNumber", "ИнвентарныйНомер");
  const name = text(record, "Name", "Наименование", "ОсновноеСредство")
    ?? (code ? `Основное средство ${code}` : null);
  if (!externalId || !UUID.test(externalId)) throw new Error(`row_${index + 1}: invalid_external_id`);
  if (!name) throw new Error(`row_${index + 1}: name_required`);
  return {
    externalId,
    code,
    inventoryNumber,
    barcode: text(record, "Barcode", "Штрихкод"),
    name,
    category: text(record, "Category", "Тип", "ГруппаУчетаОС"),
    location: text(record, "Location", "Локация", "Подразделение", "Местонахождение"),
    status: text(record, "Status", "Статус"),
    responsibleName: text(record, "ResponsibleName", "Responsible", "МОЛ", "Ответственный", "МатериальноОтветственноеЛицо"),
    responsibleExternalId: text(record, "ResponsibleExternalId", "ResponsibleGUID", "ResponsibleGuid", "GUIDМОЛ"),
    quantity: numberValue(record, "Quantity", "КолВо", "Количество") ?? 1,
    residualCost: numberValue(record, "ResidualCost", "ResidualValue", "ЦенаОстаточная", "ОстаточнаяСтоимость", "Цена"),
    acceptedAt: dateValue(record, "AcceptedAt", "AcceptanceDate", "ДатаПринятияКУчёту", "ДатаПринятия"),
    updatedAt: dateValue(record, "UpdatedAt", "ДатаИзменения", "Изменено"),
  };
}

function text(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function numberValue(record: Record<string, unknown>, ...keys: string[]): number | null {
  const value = text(record, ...keys);
  if (!value) return null;
  const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("invalid_number");
  return parsed;
}

function dateValue(record: Record<string, unknown>, ...keys: string[]): string | null {
  const value = text(record, ...keys);
  if (!value) return null;
  const iso = /^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/.test(value) ? value : value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)?.slice(1).reverse().join("-");
  if (!iso || Number.isNaN(Date.parse(iso))) throw new Error("invalid_date");
  return iso;
}

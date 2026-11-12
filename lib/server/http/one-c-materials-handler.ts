import "server-only";
import { isOneCExcludedSource } from "@/lib/one-c-integration-scope";

import { createHash, randomUUID } from "node:crypto";
import type { OneCMaterialsSnapshot, OneCMaterialsImportMetadata, OneCMaterialsImportResult } from "@/lib/contracts/one-c-materials";
import { OneCMaterialsImportError } from "@/lib/application/ports/one-c-materials-repository";
import { ApplicationError } from "@/lib/domain/application-error";
import { readLimitedBody } from "@/lib/server/http/request-body";
import { consumeExternalApiRateLimit, externalJson, externalRateLimitedResponse, verifyExternalBearer } from "@/lib/server/http/external-api";
import { currentRequestId } from "@/lib/server/observability";
import { MAX_ONE_C_MATERIALS_RECORDS, MAX_ONE_C_MATERIALS_XML_BYTES, OneCMaterialsContractError, parseOneCMaterials } from "@/lib/server/integrations/one-c-materials";

const MEDIA_TYPES = ["application/xml", "text/xml"];
const UNIT_PRICE_REQUIREMENT = {
  field: "UnitPrice", requiredFor: "positive_quantity", minimum: 0, currency: "KZT",
  maximumIntegerDigits: 12, maximumFractionDigits: 2,
  description: "Полная учётная цена за одну единицу данной позиции материала, отдельно по складу, счёту и МОЛ. Не общая сумма остатка.",
} as const;
type Dependencies = {
  service: { importSnapshot(snapshot: OneCMaterialsSnapshot, metadata: OneCMaterialsImportMetadata): Promise<OneCMaterialsImportResult> };
  apiKey?: () => string | undefined;
  bodyTimeoutMs?: number;
  logFailure?: (event: { requestId: string; errorCode: string; errorName: string }) => void;
};

export function getOneCMaterialsCapability(apiKey = process.env.ONE_C_MATERIALS_API_KEY) {
  return externalJson({
    service: "1c-materials", status: "capability", configured: Boolean(apiKey?.trim()),
    method: "POST", authentication: "Bearer token required", contentType: MEDIA_TYPES,
    maximumBytes: MAX_ONE_C_MATERIALS_XML_BYTES, maximumRecords: MAX_ONE_C_MATERIALS_RECORDS,
    snapshotAtRequired: true, warehouseUnknownAllowed: true, automaticPublication: false,
    schemaVersions: [1, 2], recommendedSchemaVersion: 2,
    version2BalanceDimensions: ["material", "account", "warehouse", "responsible"],
    pricing: UNIT_PRICE_REQUIREMENT,
  });
}

export function createOneCMaterialsPostHandler(dependencies: Dependencies) {
  // One in-flight XML per route instance bounds memory before the DB transaction lock.
  let importing = false;
  return async function post(request: Request): Promise<Response> {
    const expected = dependencies.apiKey ? dependencies.apiKey()?.trim() : process.env.ONE_C_MATERIALS_API_KEY?.trim();
    const requestId = currentRequestId() ?? randomUUID();
    const json = (body: Record<string, unknown>, status = 200, headers: HeadersInit = {}) =>
      externalJson({ ...body, requestId }, status, { ...Object.fromEntries(new Headers(headers)), "X-Request-Id": requestId });
    if (!expected) return json({ success: false, error: "integration_not_configured" }, 503);
    if (verifyExternalBearer(request, { current: expected }) === "unauthorized") return json({ success: false, error: "unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
    let ownsImportSlot = false;
    try {
      const rateLimit = await consumeExternalApiRateLimit(request, "one-c-materials", 60);
      if (!rateLimit.allowed) return externalRateLimitedResponse(rateLimit);
      const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (!mediaType || !MEDIA_TYPES.includes(mediaType)) return json({ success: false, error: "unsupported_media_type", expected: MEDIA_TYPES }, 415);
      if (importing) return json({ success: false, error: "import_in_progress" }, 429, { "Retry-After": "5" });
      importing = true;
      ownsImportSlot = true;
      const bytes = await readLimitedBody(request, MAX_ONE_C_MATERIALS_XML_BYTES, { timeoutMs: dependencies.bodyTimeoutMs ?? 120_000 });
      let xml: string;
      try { xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { throw new OneCMaterialsContractError("invalid_utf8"); }
      const snapshot = parseOneCMaterials(xml);
      const priceErrors = validateUnitPrices(snapshot);
      if (priceErrors.total > 0) return json({
        success: false, error: "unit_price_required",
        message: "Для каждой позиции с положительным остатком передайте неотрицательную цену за единицу UnitPrice. Пакет не сохранён. Нулевые остатки допускаются без цены.",
        pricing: UNIT_PRICE_REQUIREMENT,
        invalidRecords: priceErrors.total, issues: priceErrors.issues,
        issuesTruncated: priceErrors.total > priceErrors.issues.length,
      }, 422);
      const result = await dependencies.service.importSnapshot(snapshot, {
        sourceSha256: createHash("sha256").update(bytes).digest("hex"), requestId,
        sourceFilename: normalizedFilename(request.headers.get("x-source-filename")),
      });
      return json({ success: true, ...result });
    } catch (error) {
      if (error instanceof ApplicationError && error.kind === "payload_too_large") return json({ success: false, error: "xml_too_large" }, 413);
      if (error instanceof ApplicationError && error.kind === "validation") return json({ success: false, error: "invalid_request" }, 400);
      if (error instanceof ApplicationError && error.publicCode === "request_timeout") return json({ success: false, error: "import_timeout" }, 503, { "Retry-After": "5" });
      if (error instanceof OneCMaterialsContractError) return json({ success: false, error: error.code }, error.code === "xml_too_large" ? 413 : 400);
      if (error instanceof OneCMaterialsImportError) {
        if (error.code === "snapshot_conflict" || error.code === "stale_snapshot") return json({ success: false, error: error.code }, 409);
        if (error.code === "import_in_progress") return json({ success: false, error: error.code }, 429, { "Retry-After": "5" });
        logFailure(error.code, error);
        return json({ success: false, error: error.code }, 503, { "Retry-After": "5" });
      }
      logFailure("internal_error", error);
      return json({ success: false, error: "store_failed" }, 500);
    } finally {
      if (ownsImportSlot) importing = false;
    }
    function logFailure(errorCode: string, error: unknown) {
      const event = { requestId, errorCode, errorName: error instanceof Error ? error.name : "UnknownError" };
      if (dependencies.logFailure) dependencies.logFailure(event);
      else console.error("1C materials import failed", event);
    }
  };
}

function validateUnitPrices(snapshot: OneCMaterialsSnapshot) {
  const issues: {
    row: number; code: string; warehouseCode: string | null; accountCode: string | null;
    responsibleCode: string | null; responsibleExternalId: string | null;
    field: "UnitPrice"; reason: string;
  }[] = [];
  let total = 0;
  for (const [index, material] of snapshot.materials.entries()) {
    if (isOneCExcludedSource(material.name)) continue;
    if (!(Number(material.quantity) > 0)) continue;
    const value = material.unitPrice;
    const reason = value == null ? "missing_unit_price"
      : !/^\d{1,12}(?:\.\d{1,2})?$/u.test(value) ? "invalid_unit_price" : null;
    if (!reason) continue;
    total++;
    if (issues.length < 100) issues.push({
      row: index + 1, code: material.code, warehouseCode: material.warehouseCode,
      accountCode: material.accountCode ?? null, responsibleCode: material.responsibleCode ?? null,
      responsibleExternalId: material.responsibleExternalId ?? null, field: "UnitPrice", reason,
    });
  }
  return { total, issues };
}

function normalizedFilename(value: string | null) {
  if (!value) return null;
  const result = value.normalize("NFKC").trim();
  return result && result.length <= 255 && !/[\\/\0]/u.test(result) ? result : null;
}

import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { OneCFixedAssetImportService } from "@/lib/application/services/one-c-fixed-asset-import-service";
import type { OneCFixedAsset } from "@/lib/contracts/one-c-fixed-assets";
import { OneCImportUnavailableError } from "@/lib/application/ports/one-c-fixed-assets-repository";
import { ApplicationError } from "@/lib/domain/application-error";
import { readLimitedBody } from "@/lib/server/http/request-body";
import {
  consumeExternalApiRateLimit,
  externalJson,
  externalRateLimitedResponse,
  verifyExternalBearer,
} from "@/lib/server/http/external-api";
import { currentRequestId } from "@/lib/server/observability";
import { MAX_ONE_C_RECORDS, MAX_ONE_C_XML_BYTES, OneCContractError, parseOneCFixedAssets } from "@/lib/server/integrations/one-c-fixed-assets";

const ACCEPTED_MEDIA_TYPES = ["application/xml", "text/xml"];
const IMPORT_BODY_TIMEOUT_MS = 120_000;
const INITIAL_COST_REQUIREMENT = {
  field: "InitialCost", required: true, exclusiveMinimum: 0, currency: "KZT",
  maximumIntegerDigits: 12, maximumFractionDigits: 2,
  description: "Первоначальная стоимость конкретного ОС до вычета амортизации. ResidualValue передаётся отдельно и не заменяет InitialCost.",
} as const;

type Dependencies = {
  service: Pick<OneCFixedAssetImportService, "importBatch" | "tryAcquireLease">;
  apiKey?: () => string | undefined;
  logFailure?: (event: { requestId: string; errorCode: string; errorName: string }) => void;
  bodyTimeoutMs?: number;
};

export function getOneCFixedAssetsCapability(apiKey = process.env.ONE_C_FIXED_ASSETS_API_KEY) {
  return json({ service: "1c-fixed-assets", status: "capability", configured: Boolean(apiKey?.trim()), method: "POST", authentication: "Bearer token required", contentType: ACCEPTED_MEDIA_TYPES, maximumBytes: MAX_ONE_C_XML_BYTES, maximumRecords: MAX_ONE_C_RECORDS, pricing: INITIAL_COST_REQUIREMENT });
}

export function createOneCFixedAssetsPostHandler(dependencies: Dependencies) {
  return async function post(request: Request): Promise<Response> {
    const expected = dependencies.apiKey?.()?.trim() ?? process.env.ONE_C_FIXED_ASSETS_API_KEY?.trim();
    if (!expected) return json({ error: "integration_not_configured" }, 503);
    if (verifyExternalBearer(request, { current: expected }) === "unauthorized") return json({ error: "unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
    const rateLimit = await consumeExternalApiRateLimit(request, "one-c-fixed-assets", 60);
    if (!rateLimit.allowed) return externalRateLimitedResponse(rateLimit);
    const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (!mediaType || !ACCEPTED_MEDIA_TYPES.includes(mediaType)) return json({ error: "unsupported_media_type", expected: ACCEPTED_MEDIA_TYPES }, 415);

    const keyId = createHash("sha256").update(expected).digest("hex");
    const requestId = currentRequestId() ?? randomUUID();
    let lease: Awaited<ReturnType<OneCFixedAssetImportService["tryAcquireLease"]>> | null = null;
    try {
      lease = await dependencies.service.tryAcquireLease(keyId);
      if (!lease) return json({ error: "import_in_progress", requestId }, 429, { "Retry-After": "5" });
      const bytes = await readLimitedBody(request, MAX_ONE_C_XML_BYTES, { timeoutMs: dependencies.bodyTimeoutMs ?? IMPORT_BODY_TIMEOUT_MS });
      let xml: string;
      try { xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { throw new OneCContractError("invalid_utf8"); }
      const assets = parseOneCFixedAssets(xml);
      const priceErrors = validateInitialCosts(assets);
      if (priceErrors.total > 0) {
        return json({
          success: false, error: "initial_cost_required", requestId,
          message: "Передайте положительную первоначальную стоимость InitialCost для каждого ОС. Пакет не сохранён. Нулевая остаточная стоимость ResidualValue допустима.",
          pricing: INITIAL_COST_REQUIREMENT,
          invalidRecords: priceErrors.total, issues: priceErrors.issues,
          issuesTruncated: priceErrors.total > priceErrors.issues.length,
        }, 422);
      }
      const result = await dependencies.service.importBatch(assets, {
        sourceSha256: createHash("sha256").update(bytes).digest("hex"),
        requestId,
        sourceFilename: normalizedFilename(request.headers.get("x-source-filename")),
      });
      return json({ success: true, ...result, requestId });
    } catch (error) {
      if (error instanceof ApplicationError && error.kind === "payload_too_large") return json({ success: false, error: "xml_too_large", requestId }, 413);
      if (error instanceof ApplicationError && error.kind === "validation") return json({ success: false, error: "invalid_request", requestId }, 400);
      if (error instanceof ApplicationError && error.publicCode === "request_timeout") return json({ success: false, error: "import_timeout", requestId }, 503, { "Retry-After": "5" });
      if (error instanceof OneCContractError) return json({ success: false, error: error.code, requestId }, error.code === "xml_too_large" ? 413 : 400);
      if (error instanceof OneCImportUnavailableError) {
        logSafeFailure(dependencies, requestId, error.code, error.name);
        return json({ success: false, error: error.code, requestId }, 503, { "Retry-After": "5" });
      }
      logSafeFailure(dependencies, requestId, "internal_error", error instanceof Error ? error.name : "UnknownError");
      return json({ success: false, error: "store_failed", requestId }, 500);
    } finally {
      await lease?.release().catch((error) => logSafeFailure(dependencies, requestId, "lease_release_failed", error instanceof Error ? error.name : "UnknownError"));
    }
  };
}

function validateInitialCosts(assets: readonly OneCFixedAsset[]) {
  const issues: { row: number; externalId: string; code: string | null; field: "InitialCost"; reason: string }[] = [];
  let total = 0;
  for (const [index, asset] of assets.entries()) {
    const value = asset.initialCost;
    const reason = value == null ? "missing_initial_cost"
      : value === 0 ? "zero_initial_cost"
        : !Number.isFinite(value) || value < 0 || !/^\d{1,12}(?:\.\d{1,2})?$/u.test(String(value))
          ? "invalid_initial_cost" : null;
    if (!reason) continue;
    total++;
    // Keep the response bounded for bulk exports; the sender can correct all rows and retry.
    if (issues.length < 100) issues.push({ row: index + 1, externalId: asset.externalId, code: asset.code, field: "InitialCost", reason });
  }
  return { total, issues };
}

function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  const requestId = typeof body === "object" && body && "requestId" in body && typeof body.requestId === "string" ? body.requestId : undefined;
  return externalJson(body, status, { "Cache-Control": "no-store", ...Object.fromEntries(new Headers(headers)), ...(requestId ? { "X-Request-Id": requestId } : {}) });
}
function logSafeFailure(dependencies: Dependencies, requestId: string, errorCode: string, errorName: string) {
  (dependencies.logFailure ?? defaultLogFailure)({ requestId, errorCode, errorName });
}
function defaultLogFailure(event: { requestId: string; errorCode: string; errorName: string }) { console.error("1C fixed-asset import failed", event); }
function normalizedFilename(value: string | null) {
  if (!value) return null;
  const result = value.normalize("NFKC").trim();
  return result && result.length <= 255 && !/[\\/\0]/u.test(result) ? result : null;
}

import "server-only";

import { createHash } from "node:crypto";

import type {
  CreateDormitoryRequestInput,
  DormitoryRequestRepository,
  DormitoryRequestResult,
} from "@/lib/contracts/dormitory-requests";
import { ApplicationError } from "@/lib/domain/application-error";
import { externalJson, verifyExternalBearer } from "@/lib/server/http/external-api";
import { readLimitedJson } from "@/lib/server/http/request-body";
import { createPostgresDormitoryRequestRepository } from "@/lib/server/persistence/postgres/postgres-dormitory-request-repository";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(["repair", "damaged", "missing", "other"]);

export async function createDormitoryRequest(
  request: Request,
  dependencies: {
    repository?: DormitoryRequestRepository;
    onAccepted?(result: DormitoryRequestResult, description: string): void;
  } = {},
) {
  const authorization = verifyExternalBearer(request, {
    current: process.env.DORMITORY_WRITE_API_KEY,
    next: process.env.DORMITORY_WRITE_API_KEY_NEXT,
  });
  if (authorization === "not_configured") {
    return externalJson({ error: "API_NOT_CONFIGURED", message: "Dormitory write API is not configured." }, 503);
  }
  if (authorization === "unauthorized") {
    return externalJson({ error: "UNAUTHORIZED", message: "Missing or invalid API key." }, 401, { "WWW-Authenticate": "Bearer" });
  }

  try {
    const input = parseInput(await readLimitedJson(request, 16 * 1024));
    const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const repository = dependencies.repository ?? createPostgresDormitoryRequestRepository();
    const result = await repository.create(input, hash);
    if (!result.replayed) dependencies.onAccepted?.(result, input.description);
    return externalJson({ request: result }, result.replayed ? 200 : 201);
  } catch (error) {
    if (error instanceof ApplicationError) {
      const status = error.kind === "not_found" ? 404
        : error.kind === "conflict" ? 409
          : error.kind === "payload_too_large" ? 413
            : error.kind === "unsupported_media_type" ? 415 : 400;
      return externalJson({ error: error.publicCode.toUpperCase(), message: publicMessage(error.publicCode) }, status);
    }
    return externalJson(
      { error: "DEPENDENCY_UNAVAILABLE", message: "Dormitory request service is unavailable." },
      503,
      { "Retry-After": "5" },
    );
  }
}

function parseInput(value: unknown): CreateDormitoryRequestInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const body = value as Record<string, unknown>;
  if ([...Object.keys(body)].some((key) => !["externalRequestId", "itemId", "action", "description", "reporterName"].includes(key))) throw invalid();
  const externalRequestId = normalizeText(body.externalRequestId, 128);
  const itemId = typeof body.itemId === "string" && UUID.test(body.itemId) ? body.itemId.toLowerCase() : "";
  const action = typeof body.action === "string" && ACTIONS.has(body.action) ? body.action as CreateDormitoryRequestInput["action"] : null;
  const description = normalizeText(body.description, 4000);
  const reporterName = normalizeText(body.reporterName, 160);
  if (!externalRequestId || !itemId || !action || !description || !reporterName) throw invalid();
  return { externalRequestId, itemId, action, description, reporterName };
}

function normalizeText(value: unknown, maximum: number) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim();
  return normalized && [...normalized].length <= maximum ? normalized : null;
}

function invalid() { return new ApplicationError("validation", "invalid_dormitory_request"); }
function publicMessage(code: string) {
  if (code === "dormitory_item_not_found") return "Dormitory item was not found.";
  if (code === "dormitory_request_id_reused") return "externalRequestId was already used for another request.";
  return "Invalid dormitory request.";
}

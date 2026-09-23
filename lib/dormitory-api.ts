import "server-only";

import type {
  DormitoryAssetPageRequest,
  DormitoryAssetRepository,
} from "@/lib/contracts/dormitory-api";
import { externalJson, verifyExternalBearer } from "@/lib/server/http/external-api";
import { createPostgresDormitoryAssetRepository } from "@/lib/server/persistence/postgres/postgres-dormitory-asset-repository";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_MILLISECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function authorizeDormitoryRequest(request: Request): Response | null {
  const result = verifyExternalBearer(request, {
    current: process.env.DORMITORY_API_KEY,
    next: process.env.DORMITORY_API_KEY_NEXT,
  });
  if (result === "not_configured") {
    return externalJson(
      { error: "API_NOT_CONFIGURED", message: "Dormitory API is not configured." },
      503,
    );
  }
  if (result === "unauthorized") {
    return externalJson(
      { error: "UNAUTHORIZED", message: "Missing or invalid API key." },
      401,
      { "WWW-Authenticate": "Bearer" },
    );
  }
  return null;
}

export function dormitoryAuthCheck(request: Request) {
  return authorizeDormitoryRequest(request) ?? externalJson({
    valid: true,
    scope: "dormitory-assets:read",
  });
}

export async function listDormitoryAssets(
  request: Request,
  repository?: DormitoryAssetRepository,
) {
  const unauthorized = authorizeDormitoryRequest(request);
  if (unauthorized) return unauthorized;

  const page = parsePage(request);
  if (page instanceof Response) return page;

  try {
    repository ??= createPostgresDormitoryAssetRepository();
    const rows = await repository.listItems({ ...page, limit: page.limit + 1 });
    const items = rows.slice(0, page.limit);
    const last = items.at(-1);
    return externalJson({
      items,
      nextCursor: rows.length > page.limit && last
        ? encodeCursor(last.updatedAt, last.id)
        : null,
    });
  } catch {
    return externalJson(
      { error: "DEPENDENCY_UNAVAILABLE", message: "Dormitory inventory is unavailable." },
      503,
      { "Retry-After": "5" },
    );
  }
}

function parsePage(request: Request): DormitoryAssetPageRequest | Response {
  const query = new URL(request.url).searchParams;
  if (
    [...query.keys()].some((key) => key !== "limit" && key !== "cursor") ||
    query.getAll("limit").length > 1 ||
    query.getAll("cursor").length > 1
  ) return invalidPage();

  const rawLimit = query.get("limit") ?? "100";
  if (!/^\d{1,3}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 200) {
    return invalidPage();
  }

  const cursor = query.get("cursor");
  if (!cursor) return { after: null, limit: Number(rawLimit) };
  if (cursor.length > 256) return invalidPage();
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      !Array.isArray(value) || value.length !== 4 || value[0] !== 1 ||
      value[1] !== "dormitory_items" || typeof value[2] !== "string" ||
      typeof value[3] !== "string" || !ISO_MILLISECONDS.test(value[2]) ||
      new Date(value[2]).toISOString() !== value[2] || !UUID.test(value[3]) ||
      encodeCursor(value[2], value[3]) !== cursor
    ) return invalidPage();
    return { after: { updatedAt: value[2], id: value[3] }, limit: Number(rawLimit) };
  } catch {
    return invalidPage();
  }
}

function encodeCursor(updatedAt: string, id: string) {
  return Buffer.from(JSON.stringify([1, "dormitory_items", updatedAt, id])).toString("base64url");
}

function invalidPage() {
  return externalJson(
    { error: "INVALID_PAGE", message: "Invalid pagination parameters." },
    400,
  );
}

export type {
  DormitoryAsset,
  DormitoryAssetRepository,
  DormitoryAssetStatus,
} from "@/lib/contracts/dormitory-api";

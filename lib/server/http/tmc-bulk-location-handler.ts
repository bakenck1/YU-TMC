import "server-only";

import type {
  BulkChangeTmcLocationInput,
  TmcBulkOperationResultDto,
} from "@/lib/contracts/tmc-operations";
import type { UserRole } from "@/lib/contracts/users";
import { ApplicationError } from "@/lib/domain/application-error";
import { applicationErrorResponse } from "@/lib/server/http/error-response";

const MAXIMUM_BODY_BYTES = 16 * 1024;
const INPUT_FIELDS = new Set(["items", "roomId", "comment"]);
const ITEM_FIELDS = new Set(["itemId", "itemVersion"]);

export interface TmcBulkLocationPostDependencies {
  authenticate(request: Request): Promise<{ userId: string; role: UserRole }>;
  changeLocation(
    input: BulkChangeTmcLocationInput,
    actor: { userId: string; role: UserRole },
  ): Promise<TmcBulkOperationResultDto>;
}

export function createTmcBulkLocationPostHandler(
  dependencies: TmcBulkLocationPostDependencies,
) {
  return async function post(request: Request): Promise<Response> {
    try {
      const actor = await dependencies.authenticate(request);
      const input = parseInput(await readJson(request));
      const result = await dependencies.changeLocation(input, actor);
      return Response.json({ result }, {
        status: 200,
        headers: { "cache-control": "no-store" },
      });
    } catch (error) {
      return applicationErrorResponse(error, { "cache-control": "no-store" });
    }
  };
}

async function readJson(request: Request): Promise<unknown> {
  const mediaType = request.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    throw new ApplicationError("unsupported_media_type", "unsupported_media_type");
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) throw invalidRequest();
    if (Number(declaredLength) > MAXIMUM_BODY_BYTES) {
      throw new ApplicationError("payload_too_large", "payload_too_large");
    }
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAXIMUM_BODY_BYTES) {
    throw new ApplicationError("payload_too_large", "payload_too_large");
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw invalidRequest();
  }
}

function parseInput(value: unknown): BulkChangeTmcLocationInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidRequest();
  }
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).some((field) => !INPUT_FIELDS.has(field)) ||
    typeof body.roomId !== "string" ||
    !Array.isArray(body.items) ||
    body.items.length < 1 ||
    body.items.length > 50 ||
    (body.comment !== undefined &&
      body.comment !== null &&
      typeof body.comment !== "string")
  ) {
    throw invalidRequest();
  }
  const items = body.items.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw invalidRequest();
    }
    const item = value as Record<string, unknown>;
    if (
      Object.keys(item).some((field) => !ITEM_FIELDS.has(field)) ||
      typeof item.itemId !== "string" ||
      typeof item.itemVersion !== "number" ||
      !Number.isInteger(item.itemVersion)
    ) {
      throw invalidRequest();
    }
    return { itemId: item.itemId, itemVersion: item.itemVersion };
  });
  return {
    roomId: body.roomId,
    items,
    ...(body.comment !== undefined ? { comment: body.comment as string | null } : {}),
  };
}

function invalidRequest() {
  return new ApplicationError("validation", "invalid_request");
}

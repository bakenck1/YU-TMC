import { USER_ROLES, type UpdateUserInput } from "@/lib/contracts/users";
import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { readLimitedJson } from "@/lib/server/http/request-body";
import { requirePermission } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requirePermission(request, "legacy.users.manage");
    const { id } = await params;
    requireUserId(id);
    const body = await readLimitedJson(request);
    const input = parseUpdateUser(body);
    const user = await getApplicationServices().users.updateUser(
      id,
      input,
      actor.userId,
      actor.sessionVersion,
    );
    return Response.json({ user });
  } catch (error) {
    return userErrorResponse(normalizeRequestError(error));
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requirePermission(request, "legacy.users.manage");
    const { id } = await params;
    requireUserId(id);
    const url = new URL(request.url);
    const version = Number(url.searchParams.get("version"));
    if (!Number.isInteger(version) || version < 1) throw invalidRequest();
    await getApplicationServices().users.deleteUser(
      id,
      version,
      actor.userId,
      actor.sessionVersion,
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return userErrorResponse(normalizeRequestError(error));
  }
}

function parseUpdateUser(value: unknown): UpdateUserInput {
  if (!value || typeof value !== "object") throw invalidRequest();
  const input = value as Record<string, unknown>;
  if (
    typeof input.fullName !== "string" ||
    typeof input.role !== "string" ||
    !USER_ROLES.includes(input.role as (typeof USER_ROLES)[number]) ||
    (input.phone !== undefined &&
      input.phone !== null &&
      typeof input.phone !== "string") ||
    typeof input.emailVerified !== "boolean" ||
    typeof input.active !== "boolean" ||
    typeof input.version !== "number" ||
    !Number.isInteger(input.version) ||
    input.version < 1 ||
    (input.initialPassword !== undefined &&
      typeof input.initialPassword !== "string")
  ) {
    throw invalidRequest();
  }
  return {
    fullName: input.fullName,
    role: input.role as UpdateUserInput["role"],
    phone: input.phone as string | null | undefined,
    emailVerified: input.emailVerified,
    active: input.active,
    version: input.version,
    initialPassword: input.initialPassword as string | undefined,
  };
}

function invalidRequest() {
  return new ApplicationError("validation", "invalid_request");
}

function requireUserId(id: string): void {
  if (!USER_ID_PATTERN.test(id)) throw invalidRequest();
}

function normalizeRequestError(error: unknown): unknown {
  return error instanceof SyntaxError ? invalidRequest() : error;
}

function userErrorResponse(error: unknown): Response {
  return error instanceof ApplicationError
    ? applicationErrorResponse(error)
    : Response.json({ error: "users_unavailable" }, { status: 503 });
}

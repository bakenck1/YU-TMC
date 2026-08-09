import { USER_ROLES, type CreateUserInput } from "@/lib/contracts/users";
import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { readLimitedJson } from "@/lib/server/http/request-body";
import { requirePermission } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requirePermission(request, "legacy.users.read");
    return Response.json({
      users: await getApplicationServices().users.listUsers(),
    });
  } catch (error) {
    return userErrorResponse(normalizeRequestError(error));
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requirePermission(request, "legacy.users.manage");
    const body = await readLimitedJson(request);
    const input = parseCreateUser(body);
    const user = await getApplicationServices().users.createUser(
      input,
      actor.userId,
    );
    return Response.json({ user }, { status: 201 });
  } catch (error) {
    return userErrorResponse(normalizeRequestError(error));
  }
}

function parseCreateUser(value: unknown): CreateUserInput {
  if (!value || typeof value !== "object") throw invalidRequest();
  const input = value as Record<string, unknown>;
  if (
    typeof input.fullName !== "string" ||
    typeof input.email !== "string" ||
    typeof input.role !== "string" ||
    !USER_ROLES.includes(input.role as (typeof USER_ROLES)[number]) ||
    (input.phone !== undefined &&
      input.phone !== null &&
      typeof input.phone !== "string") ||
    (input.emailVerified !== undefined &&
      typeof input.emailVerified !== "boolean") ||
    (input.active !== undefined && typeof input.active !== "boolean") ||
    (input.initialPassword !== undefined &&
      typeof input.initialPassword !== "string")
  ) {
    throw invalidRequest();
  }
  return {
    fullName: input.fullName,
    email: input.email,
    role: input.role as CreateUserInput["role"],
    phone: input.phone as string | null | undefined,
    emailVerified: input.emailVerified as boolean | undefined,
    active: input.active as boolean | undefined,
    initialPassword: input.initialPassword as string | undefined,
  };
}

function invalidRequest() {
  return new ApplicationError("validation", "invalid_request");
}

function normalizeRequestError(error: unknown): unknown {
  return error instanceof SyntaxError ? invalidRequest() : error;
}

function userErrorResponse(error: unknown): Response {
  return error instanceof ApplicationError
    ? applicationErrorResponse(error)
    : Response.json({ error: "users_unavailable" }, { status: 503 });
}

import type { CreateTransferInput } from "@/lib/contracts/inventory-responsibility";
import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import {
  authorizationActor,
  requireCurrentUser,
} from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser(request);
    const transfers = await getApplicationServices().responsibility.listTransfers(
      authorizationActor(user),
    );
    return Response.json({ transfers });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser(request);
    const input = parseInput(await request.json());
    const transfer = await getApplicationServices().responsibility.requestTransfer(
      input,
      authorizationActor(user),
    );
    return Response.json({ transfer }, { status: 201 });
  } catch (error) {
    return errorResponse(error instanceof SyntaxError ? invalidRequest() : error);
  }
}

function parseInput(value: unknown): CreateTransferInput {
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as Record<string, unknown>).itemId !== "string"
  ) {
    throw invalidRequest();
  }
  return { itemId: (value as { itemId: string }).itemId };
}

function invalidRequest() {
  return new ApplicationError("validation", "invalid_request");
}

function errorResponse(error: unknown) {
  return error instanceof ApplicationError
    ? applicationErrorResponse(error)
    : Response.json({ error: "transfer_unavailable" }, { status: 503 });
}

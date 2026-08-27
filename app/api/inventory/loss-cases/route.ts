import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { readLimitedJson } from "@/lib/server/http/request-body";
import { authorizationActor, requireCurrentUser } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

export async function GET(request: Request) {
  try {
    const actor = await requireCurrentUser(request);
    return Response.json(
      { lossCases: await getApplicationServices().assetLosses.list(authorizationActor(actor)) },
      { headers: PRIVATE_NO_STORE },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireCurrentUser(request);
    const body = await readLimitedJson(request) as Record<string, unknown>;
    if (
      !body || typeof body !== "object" || typeof body.itemId !== "string" ||
      (body.employeeId !== undefined && typeof body.employeeId !== "string") ||
      (body.amount !== undefined && typeof body.amount !== "string")
    ) throw invalidRequest();
    const lossCase = await getApplicationServices().assetLosses.create(
      {
        itemId: body.itemId,
        employeeId: body.employeeId as string | undefined,
        amount: body.amount as string | undefined,
      },
      authorizationActor(actor),
    );
    return Response.json({ lossCase }, { status: 201, headers: PRIVATE_NO_STORE });
  } catch (error) {
    return errorResponse(error instanceof SyntaxError ? invalidRequest() : error);
  }
}

function invalidRequest() {
  return new ApplicationError("validation", "invalid_loss_request");
}

function errorResponse(error: unknown) {
  return error instanceof ApplicationError
    ? applicationErrorResponse(error, PRIVATE_NO_STORE)
    : Response.json({ error: "loss_cases_unavailable" }, { status: 503, headers: PRIVATE_NO_STORE });
}

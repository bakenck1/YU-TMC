import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { readLimitedJson } from "@/lib/server/http/request-body";
import { authorizationActor, requirePermission } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requirePermission(request, "inventory.item.manage_protected_fields");
    const body = await readLimitedJson(request) as Record<string, unknown>;
    if (
      !body || typeof body !== "object" ||
      (body.decision !== "approved" && body.decision !== "rejected") ||
      (body.comment !== undefined && typeof body.comment !== "string")
    ) throw invalidRequest();
    const { id } = await params;
    const lossCase = await getApplicationServices().assetLosses.review(
      id,
      {
        decision: body.decision,
        comment: body.comment as string | undefined,
      },
      authorizationActor(actor),
    );
    return Response.json({ lossCase }, { headers: PRIVATE_NO_STORE });
  } catch (error) {
    return errorResponse(error instanceof SyntaxError ? invalidRequest() : error);
  }
}

function invalidRequest() {
  return new ApplicationError("validation", "invalid_loss_review");
}

function errorResponse(error: unknown) {
  return error instanceof ApplicationError
    ? applicationErrorResponse(error, PRIVATE_NO_STORE)
    : Response.json({ error: "loss_review_unavailable" }, { status: 503, headers: PRIVATE_NO_STORE });
}

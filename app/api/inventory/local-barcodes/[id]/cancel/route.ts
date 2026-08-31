import type { CancelLocalBarcodeInput } from "@/lib/contracts/local-barcodes";
import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { readLimitedJson } from "@/lib/server/http/request-body";
import { authorizationActor, requireCurrentUser } from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireCurrentUser(request);
    const { id } = await context.params;
    const input = parseCancellation(await readLimitedJson(request));
    const execution = await getApplicationServices().localBarcodes.cancelIdempotent(id, input, authorizationActor(user), request.headers.get("idempotency-key"));
    return Response.json({ group: execution.group }, { headers: { "cache-control": "private, no-store", ...(execution.replayed ? { "idempotency-replayed": "true" } : {}) } });
  } catch (error) {
    const normalizedError = error instanceof SyntaxError
      ? new ApplicationError("validation", "invalid_local_cancellation")
      : error;
    return normalizedError instanceof ApplicationError ? applicationErrorResponse(normalizedError) : Response.json({ error: "local_barcode_cancel_unavailable" }, { status: 503 });
  }
}

function parseCancellation(value: unknown): CancelLocalBarcodeInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApplicationError("validation", "invalid_local_cancellation");
  }
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some((key) => key !== "version" && key !== "reason") ||
    typeof input.version !== "number" ||
    typeof input.reason !== "string"
  ) {
    throw new ApplicationError("validation", "invalid_local_cancellation");
  }
  return { version: input.version, reason: input.reason };
}

import type { CreateInspectionInput } from "@/lib/contracts/inventory-inspections";
import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { readLimitedJson } from "@/lib/server/http/request-body";
import { after } from "next/server";
import {
  authorizationActor,
  requireCurrentUser,
} from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser(request);
    const inspections = await getApplicationServices().inspections.list(
      authorizationActor(user),
    );
    return Response.json({ inspections });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser(request);
    const body = await readLimitedJson(request);
    if (
      !body ||
      typeof body !== "object" ||
      typeof (body as Record<string, unknown>).name !== "string"
    ) {
      throw new ApplicationError("validation", "invalid_request");
    }
    const services = getApplicationServices();
    const inspection = await services.inspections.create(
      {
        name: (body as { name: string }).name,
        technicianId: (body as { technicianId?: unknown }).technicianId as
          | string
          | undefined,
        deadlineAt: (body as { deadlineAt?: unknown }).deadlineAt as string | undefined,
      } satisfies CreateInspectionInput,
      authorizationActor(user),
    );
    after(() =>
      services.push.notifyInspectionAssignment({
        inspectionId: inspection.id,
        inspectionName: inspection.name,
        technicianId: inspection.technicianId,
      }),
    );
    return Response.json({ inspection }, { status: 201 });
  } catch (error) {
    return errorResponse(
      error instanceof SyntaxError
        ? new ApplicationError("validation", "invalid_request")
        : error,
    );
  }
}

function errorResponse(error: unknown) {
  return error instanceof ApplicationError
    ? applicationErrorResponse(error)
    : Response.json({ error: "inspections_unavailable" }, { status: 503 });
}

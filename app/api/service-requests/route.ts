import type {
  CreateServiceRequestInput,
  ServiceRequestFilters,
} from "@/lib/contracts/service-requests";
import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import {
  assertPhotoJsonRequest,
  readPhotoJsonRequest,
} from "@/lib/server/http/photo-request";
import {
  authorizationActor,
  requireCurrentUser,
} from "@/lib/server/security/request-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE_RESPONSE_HEADERS = {
  "cache-control": "private, no-store, max-age=0, must-revalidate",
};

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser(request);
    const url = new URL(request.url);
    const requests = await getApplicationServices().requests.list(
      parseFilters(url.searchParams),
      authorizationActor(user),
    );
    return Response.json({ requests }, { headers: PRIVATE_RESPONSE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser(request);
    assertPhotoJsonRequest(request);
    const serviceRequest = await getApplicationServices().requests.create(
      parseCreate(await readPhotoJsonRequest(request)),
      authorizationActor(user),
    );
    return Response.json(
      { request: serviceRequest },
      { status: 201, headers: PRIVATE_RESPONSE_HEADERS },
    );
  } catch (error) {
    return errorResponse(error instanceof SyntaxError ? invalidRequest() : error);
  }
}

function parseFilters(params: URLSearchParams): ServiceRequestFilters {
  const status = params.get("status");
  const roomId = params.get("roomId");
  const employeeId = params.get("employeeId");
  const dateFrom = parseDate(params.get("dateFrom"), false);
  const dateTo = parseDate(params.get("dateTo"), true);
  if (
    status !== null &&
    status !== "new" &&
    status !== "in_progress" &&
    status !== "completed"
  ) throw invalidRequest();
  return {
    ...(status ? { status } : {}),
    ...(roomId ? { roomId } : {}),
    ...(employeeId ? { employeeId } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
  };
}

function parseDate(value: string | null, endOfDay: boolean) {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalidRequest();
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  if (Number.isNaN(date.getTime())) throw invalidRequest();
  return date;
}

function parseCreate(value: unknown): CreateServiceRequestInput {
  if (!value || typeof value !== "object") throw invalidRequest();
  const body = value as Record<string, unknown>;
  if (
    typeof body.itemId !== "string" ||
    typeof body.description !== "string" ||
    (body.type !== "not_working" &&
      body.type !== "not_connected" &&
      body.type !== "damaged" &&
      body.type !== "missing") ||
    !body.photo ||
    typeof body.photo !== "object"
  ) throw invalidRequest();
  const photo = body.photo as Record<string, unknown>;
  if (
    typeof photo.imageDataUrl !== "string" ||
    !Number.isInteger(photo.width) ||
    !Number.isInteger(photo.height)
  ) throw invalidRequest();
  return {
    itemId: body.itemId,
    type: body.type,
    description: body.description,
    photo: {
      imageDataUrl: photo.imageDataUrl,
      width: photo.width as number,
      height: photo.height as number,
    },
  };
}

function invalidRequest() {
  return new ApplicationError("validation", "invalid_service_request");
}

function errorResponse(error: unknown) {
  return error instanceof ApplicationError
    ? applicationErrorResponse(error, PRIVATE_RESPONSE_HEADERS)
    : Response.json(
        { error: "service_requests_unavailable" },
        { status: 503, headers: PRIVATE_RESPONSE_HEADERS },
      );
}

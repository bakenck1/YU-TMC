import { authorizationActor, requirePermission } from "@/lib/server/security/request-user";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { readLimitedJson } from "@/lib/server/http/request-body";
import { ApplicationError } from "@/lib/domain/application-error";
import { getOneCAnalyticsSnapshot } from "@/lib/server/one-c-analytics-service";
import { confirmOneCPossibleMatch, getOneCPossibleMatches } from "@/lib/server/one-c-possible-matches";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "cache-control": "private, no-store" };

export async function GET(request: Request) {
  try {
    await requirePermission(request, "inventory.integration.one_c.manage");
    return Response.json({ data: getOneCPossibleMatches(await getOneCAnalyticsSnapshot()) }, { headers });
  } catch (error) { return applicationErrorResponse(error, headers); }
}

export async function POST(request: Request) {
  try {
    const actor = authorizationActor(await requirePermission(request, "inventory.integration.one_c.manage"));
    const value = await readLimitedJson(request, 8 * 1024);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
    const body = value as Record<string, unknown>;
    if (Object.keys(body).some(key => !["itemId", "itemVersion", "reviewHash", "code"].includes(key))
      || typeof body.itemId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(body.itemId)
      || !Number.isSafeInteger(body.itemVersion) || Number(body.itemVersion) < 1
      || typeof body.reviewHash !== "string" || !/^[0-9a-f]{64}$/u.test(body.reviewHash)
      || typeof body.code !== "string" || !body.code.trim() || body.code !== body.code.trim()
      || body.code.length > 64 || /[\u0000-\u001f\u007f]/u.test(body.code)) throw invalid();
    const result = await confirmOneCPossibleMatch({ itemId: body.itemId, itemVersion: Number(body.itemVersion), reviewHash: body.reviewHash, code: body.code }, actor);
    return Response.json(result, { headers });
  } catch (error) { return applicationErrorResponse(error instanceof SyntaxError ? invalid() : error, headers); }
}

function invalid() { return new ApplicationError("validation", "invalid_request"); }

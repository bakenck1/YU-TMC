import "server-only";
import { ApplicationError } from "@/lib/domain/application-error";
import type { OneCAdminActor } from "@/lib/server/http/one-c-reconciliation-admin-handler";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { readLimitedJson } from "@/lib/server/http/request-body";

type Dependencies = {
  authenticate(request: Request): Promise<OneCAdminActor>;
  service(): {
    preview(batchId: string, actor: OneCAdminActor): Promise<unknown>;
    apply(batchId: string, input: { runId: string; planHash: string }, actor: OneCAdminActor): Promise<unknown>;
  };
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIVATE = { "cache-control": "private, no-store" };
type Context = { params: Promise<{ id: string }> };

export function createInventoryAuditEnrichmentHandlers(dependencies: Dependencies) {
  const handle = async (request: Request, context: Context, mutation: boolean) => {
    try {
      const actor = await dependencies.authenticate(request);
      const { id } = await context.params;
      if (!UUID.test(id) || new URL(request.url).search) throw invalid();
      if (!mutation) return Response.json({ plan: await dependencies.service().preview(id, actor) }, { headers: PRIVATE });
      const body = await readLimitedJson(request, 1024);
      if (!body || typeof body !== "object" || Array.isArray(body)) throw invalid();
      const value = body as Record<string, unknown>;
      if (Object.keys(value).length !== 2 || typeof value.runId !== "string" || !UUID.test(value.runId)
        || typeof value.planHash !== "string" || !/^[a-f0-9]{64}$/u.test(value.planHash)) throw invalid();
      return Response.json({ result: await dependencies.service().apply(id, { runId: value.runId, planHash: value.planHash }, actor) }, { headers: PRIVATE });
    } catch (error) { return applicationErrorResponse(error, PRIVATE); }
  };
  return { GET: (request: Request, context: Context) => handle(request, context, false),
    POST: (request: Request, context: Context) => handle(request, context, true) };
}
function invalid() { return new ApplicationError("validation", "invalid_request"); }

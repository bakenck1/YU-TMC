import "server-only";
import { ApplicationError } from "@/lib/domain/application-error";
import type { OneCAdminActor } from "@/lib/server/http/one-c-reconciliation-admin-handler";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { readLimitedJson } from "@/lib/server/http/request-body";

type Dependencies = {
  authenticate(request: Request): Promise<OneCAdminActor>;
  service(): {
    previewCurrent(actor: OneCAdminActor): Promise<unknown>;
    applyCurrent(input: { runId: string; planHash: string }, actor: OneCAdminActor): Promise<unknown>;
  };
};
const PRIVATE = { "cache-control": "private, no-store" };

export function createOneCCurrentEnrichmentHandlers(dependencies: Dependencies) {
  async function handle(request: Request, mutation: boolean) {
    try {
      const actor = await dependencies.authenticate(request);
      if (new URL(request.url).search) throw invalid();
      if (!mutation) return Response.json({ plan: await dependencies.service().previewCurrent(actor) }, { headers: PRIVATE });
      const body = await readLimitedJson(request, 1024);
      if (!body || typeof body !== "object" || Array.isArray(body)) throw invalid();
      const value = body as Record<string, unknown>;
      if (Object.keys(value).length !== 2 || value.runId !== "current-registry"
        || typeof value.planHash !== "string" || !/^[a-f0-9]{64}$/u.test(value.planHash)) throw invalid();
      return Response.json({ result: await dependencies.service().applyCurrent({ runId: value.runId, planHash: value.planHash }, actor) }, { headers: PRIVATE });
    } catch (error) { return applicationErrorResponse(error, PRIVATE); }
  }
  return { GET: (request: Request) => handle(request, false), POST: (request: Request) => handle(request, true) };
}
function invalid() { return new ApplicationError("validation", "invalid_request"); }

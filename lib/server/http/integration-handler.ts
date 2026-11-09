import "server-only";
import { setTimeout as delay } from "node:timers/promises";
import { INTEGRATION_ENTITIES, type IntegrationEntity, type IntegrationRepository } from "@/lib/contracts/integration-api";
import { ApplicationError } from "@/lib/domain/application-error";
import { integrationCredential, integrationGuard } from "@/lib/server/integration-auth";
import { externalJson, externalResponseHeaders } from "@/lib/server/http/external-api";
import { createPostgresIntegrationRepository } from "@/lib/server/persistence/postgres/postgres-integration-repository";

interface Dependencies {
  repository?: IntegrationRepository;
  guard?: typeof integrationGuard;
  credentialValid?: (request: Request) => boolean;
  streamLifetimeMs?: number;
  pollIntervalMs?: number;
}
const MAX_BIGINT = BigInt("9223372036854775807");
const MAX_XID = BigInt("18446744073709551615");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validIntegrationCursor(value: string) {
  if (!/^(0|[1-9]\d{0,19}):(0|[1-9]\d{0,18})$/.test(value)) return false;
  const [xid, id] = value.split(":");
  return BigInt(xid) <= MAX_XID && BigInt(id) <= MAX_BIGINT;
}

export function createIntegrationHandler(dependencies: Dependencies = {}) {
  return async function handle(request: Request, resource: string): Promise<Response> {
    const streaming = resource === "events";
    const denied = await (dependencies.guard ?? integrationGuard)(request, streaming);
    if (denied) return denied;
    try {
      const query = new URL(request.url).searchParams;
      const allowed = ["after", "limit"];
      if ([...query.keys()].some((key) => !allowed.includes(key) || query.getAll(key).length !== 1)) return invalid();
      const repository = dependencies.repository ?? createPostgresIntegrationRepository();
      if (resource === "auth/check") {
        if (query.size) return invalid();
        return externalJson({ valid: true, scope: "integration:read", entities: INTEGRATION_ENTITIES });
      }
      if (resource === "checkpoint") {
        if (query.size) return invalid();
        return externalJson({ cursor: await repository.checkpoint() });
      }
      const rawLimit = query.get("limit") ?? "100";
      if (!/^[1-9]\d{0,2}$/.test(rawLimit) || Number(rawLimit) > 100) return invalid();
      const limit = Number(rawLimit);
      if (resource === "changes" || streaming) {
        const queryAfter = query.get("after");
        if (queryAfter !== null && !validIntegrationCursor(queryAfter)) return invalid();
        const after = (streaming ? request.headers.get("last-event-id") : null) ?? queryAfter ?? "0:0";
        if (!validIntegrationCursor(after)) return invalid();
        const page = await repository.changes(after, limit);
        if (!streaming) return externalJson(page);
        return eventStream(request, after, page, repository, limit, dependencies);
      }
      if (!INTEGRATION_ENTITIES.includes(resource as IntegrationEntity)) return externalJson({ error: "NOT_FOUND" }, 404);
      const after = query.get("after");
      if (after !== null && !UUID.test(after)) return invalid();
      const rows = await repository.list(resource as IntegrationEntity, after, limit + 1);
      const data = rows.slice(0, limit);
      return externalJson({ data, nextCursor: rows.length > limit ? data.at(-1)!.id : null });
    } catch (error) {
      if (error instanceof ApplicationError && error.kind === "validation") return invalid(error.publicCode);
      return externalJson({ error: "DEPENDENCY_UNAVAILABLE" }, 503, { "Retry-After": "5" });
    }
  };
}

function eventStream(
  request: Request, after: string, initial: Awaited<ReturnType<IntegrationRepository["changes"]>>,
  repository: IntegrationRepository, limit: number, dependencies: Dependencies,
) {
  const stop = new AbortController();
  const encoder = new TextEncoder();
  let cursor = after;
  let page: typeof initial | undefined = initial;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  let timer: ReturnType<typeof setTimeout>;
  const cleanup = () => {
    closed = true;
    clearTimeout(timer);
    stop.abort();
    request.signal.removeEventListener("abort", close);
  };
  const close = () => { if (!closed) { cleanup(); controller.close(); } };
  const send = (event: string, data: unknown, id?: string) =>
    encoder.encode(`${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
      timer = setTimeout(close, dependencies.streamLifetimeMs ?? 55_000);
      request.signal.addEventListener("abort", close, { once: true });
      if (request.signal.aborted) close();
    },
    async pull(value) {
      try {
        if (closed) return;
        const valid = dependencies.credentialValid?.(request) ?? Boolean(integrationCredential(request));
        if (!valid) { value.enqueue(send("revoked", { error: "UNAUTHORIZED" })); close(); return; }
        const current = page ?? await repository.changes(cursor, limit);
        page = undefined;
        if (closed) return;
        const chunks = current.changes.map((change) =>
          `id: ${change.cursor}\nevent: change\ndata: ${JSON.stringify(change)}\n\n`,
        ).join("");
        cursor = current.nextCursor;
        value.enqueue(encoder.encode(chunks + new TextDecoder().decode(send("checkpoint", { cursor }, cursor))));
        if (!current.hasMore) await delay(dependencies.pollIntervalMs ?? 2_000, undefined, { signal: stop.signal });
      } catch {
        if (!closed) { value.enqueue(send("unavailable", { error: "DEPENDENCY_UNAVAILABLE" })); close(); }
      }
    },
    cancel() { if (!closed) cleanup(); },
  }, { highWaterMark: 0 });
  return new Response(body, { headers: externalResponseHeaders({
    "Content-Type": "text/event-stream; charset=utf-8", "X-Accel-Buffering": "no", "X-Content-Type-Options": "nosniff",
  }) });
}

function invalid(error = "INVALID_QUERY") { return externalJson({ error }, 400); }

import "server-only";

import { ApplicationError } from "@/lib/domain/application-error";
import type { AuthorizationActor } from "@/lib/security/permissions";
import { applicationErrorResponse } from "@/lib/server/http/error-response";
import { readLimitedJson } from "@/lib/server/http/request-body";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const MAX_PAGE_SIZE = 100;
const MAX_BULK_ROWS = 100;
const MUTATION_BODY_LIMIT = 64 * 1024;
const PRIVATE = { "cache-control": "private, no-store" };

const BATCH_STATES = new Set([
  "received", "analyzing", "review_required", "approved", "publishing",
  "published", "failed", "rejected", "superseded",
]);
const REVIEW_STATES = new Set([
  "pending", "ready", "matched", "conflict", "blocked", "excluded",
  "approved", "published", "failed",
]);
const ACTIONS = new Set([
  "create", "link", "update", "exclude", "manual_review", "no_change",
]);

export type OneCAdminActor = AuthorizationActor & { sessionVersion?: number };

export type OneCBatchListQuery = {
  page: number;
  pageSize: number;
  state?: string;
};

export type OneCBatchRowsQuery = {
  page: number;
  pageSize: number;
  reviewState?: string;
  proposedAction?: string;
  search?: string;
};

export type OneCDecisionInput = {
  version: number;
  decision: Readonly<Record<string, unknown>>;
};

export type OneCBulkDecisionInput = OneCDecisionInput & {
  externalIds: readonly string[];
};

export type OneCPlanInput = { version: number; planHash?: string };

/**
 * HTTP-facing contract only. The reconciliation application service can
 * implement it without importing route or Next.js types.
 */
export interface OneCReconciliationAdminService {
  listBatches(query: OneCBatchListQuery, actor: OneCAdminActor): Promise<unknown>;
  getBatch(batchId: string, actor: OneCAdminActor): Promise<unknown>;
  listBatchRows(batchId: string, query: OneCBatchRowsQuery, actor: OneCAdminActor): Promise<unknown>;
  analyzeBatch(batchId: string, input: OneCPlanInput, actor: OneCAdminActor): Promise<unknown>;
  decideRow(batchId: string, externalId: string, input: OneCDecisionInput, actor: OneCAdminActor): Promise<unknown>;
  decideRowsBulk(batchId: string, input: OneCBulkDecisionInput, actor: OneCAdminActor): Promise<unknown>;
  approveBatch(batchId: string, input: Required<OneCPlanInput>, actor: OneCAdminActor): Promise<unknown>;
  publishBatch(batchId: string, input: Required<OneCPlanInput> & { idempotencyKey: string }, actor: OneCAdminActor): Promise<unknown>;
  getPublication(publicationId: string, actor: OneCAdminActor): Promise<unknown>;
}

export type OneCReconciliationAdminDependencies = {
  authenticate(request: Request): Promise<OneCAdminActor>;
  service(): OneCReconciliationAdminService;
};

type IdContext = { params: Promise<{ id: string }> };
type RowContext = { params: Promise<{ id: string; externalId: string }> };

export function createOneCReconciliationAdminHandlers(
  dependencies: OneCReconciliationAdminDependencies,
) {
  return {
    listBatches: (request: Request) => execute(async () => {
      const actor = await dependencies.authenticate(request);
      const result = await dependencies.service().listBatches(parseBatchQuery(request.url), actor);
      return json({ batches: result });
    }),

    getBatch: (request: Request, context: IdContext) => execute(async () => {
      const actor = await dependencies.authenticate(request);
      const { id } = await validId(context);
      return json({ batch: await dependencies.service().getBatch(id, actor) });
    }),

    listBatchRows: (request: Request, context: IdContext) => execute(async () => {
      const actor = await dependencies.authenticate(request);
      const { id } = await validId(context);
      const result = await dependencies.service().listBatchRows(id, parseRowsQuery(request.url), actor);
      return json({ rows: result });
    }),

    analyzeBatch: (request: Request, context: IdContext) => execute(async () => {
      const actor = await dependencies.authenticate(request);
      const { id } = await validId(context);
      const input = parsePlanInput(await readLimitedJson(request, MUTATION_BODY_LIMIT), false);
      return json({ analysis: await dependencies.service().analyzeBatch(id, input, actor) });
    }),

    decideRow: (request: Request, context: RowContext) => execute(async () => {
      const actor = await dependencies.authenticate(request);
      const { id, externalId } = await context.params;
      assertUuid(id);
      assertUuid(externalId);
      const input = parseDecision(await readLimitedJson(request, MUTATION_BODY_LIMIT));
      return json({ row: await dependencies.service().decideRow(id, externalId, input, actor) });
    }),

    decideRowsBulk: (request: Request, context: IdContext) => execute(async () => {
      const actor = await dependencies.authenticate(request);
      const { id } = await validId(context);
      const input = parseBulkDecision(await readLimitedJson(request, MUTATION_BODY_LIMIT));
      return json({ result: await dependencies.service().decideRowsBulk(id, input, actor) });
    }),

    approveBatch: (request: Request, context: IdContext) => execute(async () => {
      const actor = await dependencies.authenticate(request);
      const { id } = await validId(context);
      const input = parsePlanInput(await readLimitedJson(request, MUTATION_BODY_LIMIT), true) as Required<OneCPlanInput>;
      return json({ batch: await dependencies.service().approveBatch(id, input, actor) });
    }),

    publishBatch: (request: Request, context: IdContext) => execute(async () => {
      const actor = await dependencies.authenticate(request);
      const { id } = await validId(context);
      const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
      if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) throw invalid("idempotency_key_invalid");
      const input = parsePlanInput(await readLimitedJson(request, MUTATION_BODY_LIMIT), true) as Required<OneCPlanInput>;
      const publication = await dependencies.service().publishBatch(id, { ...input, idempotencyKey }, actor);
      return json({ publication }, 202);
    }),

    getPublication: (request: Request, context: IdContext) => execute(async () => {
      const actor = await dependencies.authenticate(request);
      const { id } = await validId(context);
      return json({ publication: await dependencies.service().getPublication(id, actor) });
    }),
  };
}

function parseBatchQuery(url: string): OneCBatchListQuery {
  const query = new URL(url).searchParams;
  assertKnownQuery(query, new Set(["page", "pageSize", "state"]));
  const result: OneCBatchListQuery = {
    page: parsePositiveInteger(query.get("page"), 1),
    pageSize: parsePageSize(query.get("pageSize")),
  };
  const state = query.get("state");
  if (state !== null) {
    if (!BATCH_STATES.has(state)) throw invalid();
    result.state = state;
  }
  return result;
}

function parseRowsQuery(url: string): OneCBatchRowsQuery {
  const query = new URL(url).searchParams;
  assertKnownQuery(query, new Set(["page", "pageSize", "reviewState", "proposedAction", "search"]));
  const result: OneCBatchRowsQuery = {
    page: parsePositiveInteger(query.get("page"), 1),
    pageSize: parsePageSize(query.get("pageSize")),
  };
  const reviewState = query.get("reviewState");
  if (reviewState !== null) {
    if (!REVIEW_STATES.has(reviewState)) throw invalid();
    result.reviewState = reviewState;
  }
  const proposedAction = query.get("proposedAction");
  if (proposedAction !== null) {
    if (!ACTIONS.has(proposedAction)) throw invalid();
    result.proposedAction = proposedAction;
  }
  const search = query.get("search");
  if (search !== null) {
    const normalized = search.trim();
    if (normalized.length < 1 || normalized.length > 160) throw invalid();
    result.search = normalized;
  }
  return result;
}

function parseDecision(value: unknown): OneCDecisionInput {
  const body = object(value);
  assertExactKeys(body, new Set(["version", "decision"]));
  return { version: version(body.version), decision: decision(body.decision) };
}

function parseBulkDecision(value: unknown): OneCBulkDecisionInput {
  const body = object(value);
  assertExactKeys(body, new Set(["version", "decision", "externalIds"]));
  if (!Array.isArray(body.externalIds) || body.externalIds.length < 1 || body.externalIds.length > MAX_BULK_ROWS) throw invalid();
  const externalIds = body.externalIds.map((id) => {
    if (typeof id !== "string") throw invalid();
    assertUuid(id);
    return id.toLowerCase();
  });
  if (new Set(externalIds).size !== externalIds.length) throw invalid();
  return { version: version(body.version), decision: decision(body.decision), externalIds };
}

function parsePlanInput(value: unknown, requireHash: boolean): OneCPlanInput {
  const body = object(value);
  assertExactKeys(body, new Set(["version", "planHash"]));
  const planHash = body.planHash;
  if (requireHash && (typeof planHash !== "string" || !HASH_PATTERN.test(planHash))) throw invalid();
  if (planHash !== undefined && (typeof planHash !== "string" || !HASH_PATTERN.test(planHash))) throw invalid();
  return { version: version(body.version), ...(typeof planHash === "string" ? { planHash } : {}) };
}

function decision(value: unknown): Readonly<Record<string, unknown>> {
  const parsed = object(value);
  const keys = Object.keys(parsed);
  if (keys.length < 1 || keys.length > 32) throw invalid();
  return parsed;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}

function version(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw invalid();
  return value;
}

function parsePageSize(value: string | null) {
  const parsed = parsePositiveInteger(value, 50);
  if (parsed > MAX_PAGE_SIZE) throw invalid("page_size_too_large");
  return parsed;
}

function parsePositiveInteger(value: string | null, fallback: number) {
  if (value === null) return fallback;
  if (!/^[1-9]\d*$/.test(value)) throw invalid();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw invalid();
  return parsed;
}

function assertKnownQuery(query: URLSearchParams, allowed: ReadonlySet<string>) {
  for (const key of query.keys()) if (!allowed.has(key)) throw invalid();
}

function assertExactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw invalid();
}

async function validId(context: IdContext) {
  const params = await context.params;
  assertUuid(params.id);
  return params;
}

function assertUuid(value: string): void {
  if (!UUID_PATTERN.test(value)) throw invalid();
}

function invalid(code = "invalid_request") {
  return new ApplicationError("validation", code);
}

async function execute(work: () => Promise<Response>) {
  try {
    return await work();
  } catch (error) {
    return error instanceof ApplicationError
      ? applicationErrorResponse(error, PRIVATE)
      : Response.json({ error: "one_c_reconciliation_unavailable" }, { status: 503, headers: PRIVATE });
  }
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: PRIVATE });
}

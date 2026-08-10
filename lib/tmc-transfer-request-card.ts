import type {
  TmcTransferRequestCardItemView,
  TmcTransferRequestCardView,
} from "@/lib/tmc-transfer-request-detail-view";

export function shouldRetainTmcDecisionAttempt(status: number, errorCode: string) {
  return errorCode === "idempotency_request_in_progress" || status >= 500;
}

export function buildTmcRequestDecisions(
  request: TmcTransferRequestCardView,
  selection: ReadonlySet<string>,
  mode: "all" | "selected" | "reject",
) {
  return request.items
    .filter((item) => item.result === "pending")
    .map((item) => ({
      itemId: item.item.id,
      itemVersion: item.version,
      decision: mode === "all" || (mode === "selected" && selection.has(item.id))
        ? "accept" as const
        : "reject" as const,
    }));
}

export function createTmcRequestSelection(
  request: TmcTransferRequestCardView,
  canDecide: boolean,
): ReadonlySet<string> {
  return new Set(
    canDecide
      ? request.items.filter((item) => item.result === "pending").map((item) => item.id)
      : [],
  );
}

export function toggleTmcRequestSelection(
  selection: ReadonlySet<string>,
  item: TmcTransferRequestCardItemView,
  canDecide: boolean,
): ReadonlySet<string> {
  if (!canDecide || item.result !== "pending") return selection;
  const next = new Set(selection);
  if (next.has(item.id)) next.delete(item.id);
  else next.add(item.id);
  return next;
}

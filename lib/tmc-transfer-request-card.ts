import type { TmcTransferRequestDto, TmcTransferRequestItemDto } from "@/lib/contracts/tmc-operations";

export function createTmcRequestSelection(
  request: TmcTransferRequestDto,
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
  item: TmcTransferRequestItemDto,
  canDecide: boolean,
): ReadonlySet<string> {
  if (!canDecide || item.result !== "pending") return selection;
  const next = new Set(selection);
  if (next.has(item.id)) next.delete(item.id);
  else next.add(item.id);
  return next;
}

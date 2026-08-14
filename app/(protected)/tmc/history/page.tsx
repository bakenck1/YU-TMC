import TmcHistory from "@/components/TmcHistory";
import type { TmcTransferHistoryFilters } from "@/lib/contracts/tmc-operations";
import { getApplicationServices } from "@/lib/server/application";
import { requireAuthorizedPage } from "@/lib/server/security/page-access";
import { toTmcHistoryPageView } from "@/lib/tmc-history-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function TmcHistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireAuthorizedPage("/tmc/history");
  const raw = await searchParams;
  const filters: TmcTransferHistoryFilters = {};
  for (const key of ["status", "createdFrom", "createdTo", "initiatorId", "recipientId", "buildingId", "roomId", "itemId"] as const) {
    const value = raw[key];
    if (typeof value === "string" && value) Object.assign(filters, { [key]: value });
  }
  if (raw.overdue === "true") filters.overdue = true;
  for (const key of ["requestCursor", "locationCursor"] as const) {
    const value = raw[key];
    if (typeof value === "string" && value) filters[key] = value;
  }
  const result = await getApplicationServices().tmcTransferRequests.listHistory(filters, {
    userId: user.userId,
    role: user.role,
    sessionVersion: user.sessionVersion,
  });
  const view = toTmcHistoryPageView(result);
  return <TmcHistory
    requests={view.requests}
    locationChanges={view.locationChanges}
    nextRequestHref={cursorHref(raw, "requestCursor", result.nextRequestCursor)}
    nextLocationHref={cursorHref(raw, "locationCursor", result.nextLocationCursor)}
  />;
}

function cursorHref(raw: Record<string, string | string[] | undefined>, key: "requestCursor" | "locationCursor", cursor: string | null) {
  if (!cursor) return null;
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === "string" && name !== key) search.set(name, value);
  }
  search.set(key, cursor);
  return `/tmc/history?${search.toString()}`;
}

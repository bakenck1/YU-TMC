import "server-only";

import type { TmcNotificationFeedDto, TmcTransferHistoryDto, TmcTransferHistoryFilters } from "@/lib/contracts/tmc-operations";
import type { UserRole } from "@/lib/contracts/users";
import { ApplicationError } from "@/lib/domain/application-error";
import { applicationErrorResponse } from "@/lib/server/http/error-response";

const HISTORY_PARAMETERS = new Set(["status", "createdFrom", "createdTo", "initiatorId", "recipientId", "buildingId", "roomId", "itemId", "overdue", "limit", "requestCursor", "locationCursor"]);
type Actor = { userId: string; role: UserRole };

export function createTmcHistoryGetHandler(dependencies: {
  authenticate(request: Request): Promise<Actor>;
  listHistory(filters: TmcTransferHistoryFilters, actor: Actor): Promise<TmcTransferHistoryDto>;
}) {
  return async (request: Request) => {
    try {
      const actor = await dependencies.authenticate(request);
      const search = new URL(request.url).searchParams;
      if ([...search.keys()].some((key) => !HISTORY_PARAMETERS.has(key)) || [...HISTORY_PARAMETERS].some((key) => search.getAll(key).length > 1)) throw invalid();
      const filters: TmcTransferHistoryFilters = {};
      for (const key of ["status", "createdFrom", "createdTo", "initiatorId", "recipientId", "buildingId", "roomId", "itemId"] as const) {
        const value = search.get(key);
        if (value !== null) Object.assign(filters, { [key]: value });
      }
      const overdue = search.get("overdue");
      if (overdue !== null) {
        if (overdue !== "true" && overdue !== "false") throw invalid();
        filters.overdue = overdue === "true";
      }
      const limit = search.get("limit");
      if (limit !== null) {
        if (!/^[1-9]\d?$/.test(limit) || Number(limit) > 50) throw invalid();
        filters.limit = Number(limit);
      }
      for (const key of ["requestCursor", "locationCursor"] as const) {
        const value = search.get(key);
        if (value !== null) {
          if (value.length > 160 || !/^[A-Za-z0-9_-]+$/.test(value)) throw invalid();
          filters[key] = value;
        }
      }
      return Response.json(await dependencies.listHistory(filters, actor), { headers: { "cache-control": "no-store" } });
    } catch (error) {
      return applicationErrorResponse(error, { "cache-control": "no-store" });
    }
  };
}

export function createTmcNotificationsGetHandler(dependencies: {
  authenticate(request: Request): Promise<Actor>;
  listNotifications(actor: Actor, limit: number): Promise<TmcNotificationFeedDto>;
}) {
  return async (request: Request) => {
    try {
      const actor = await dependencies.authenticate(request);
      const search = new URL(request.url).searchParams;
      if ([...search.keys()].some((key) => key !== "limit") || search.getAll("limit").length > 1) throw invalid();
      const rawLimit = search.get("limit") ?? "25";
      if (!/^[1-9]\d?$/.test(rawLimit) || Number(rawLimit) > 50) throw invalid();
      return Response.json(await dependencies.listNotifications(actor, Number(rawLimit)), { headers: { "cache-control": "no-store" } });
    } catch (error) {
      return applicationErrorResponse(error, { "cache-control": "no-store" });
    }
  };
}

export function createTmcNotificationReadPostHandler(dependencies: {
  authenticate(request: Request): Promise<Actor>;
  markRead(notificationId: string, actor: Actor): Promise<void>;
}) {
  return async (request: Request, notificationId: string) => {
    try {
      const actor = await dependencies.authenticate(request);
      if (request.body !== null) throw invalid();
      await dependencies.markRead(notificationId, actor);
      return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    } catch (error) {
      return applicationErrorResponse(error, { "cache-control": "no-store" });
    }
  };
}

function invalid() { return new ApplicationError("validation", "invalid_request"); }

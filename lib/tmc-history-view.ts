import type {
  TmcTransferHistoryDto,
  TmcTransferRequestStatus,
} from "@/lib/contracts/tmc-operations";

export interface TmcHistoryRequestView {
  id: string;
  initiator: { id: string; fullName: string };
  recipient: { id: string; fullName: string };
  status: TmcTransferRequestStatus;
  createdAt: string;
  overdue: boolean;
  summary: { total: number };
  items: Array<{
    item: {
      id: string;
      name: string;
      inventoryNumber: string;
      location: {
        buildingId: string;
        buildingName: string;
        roomId: string;
        roomDesignation: string;
      };
    };
  }>;
}

export interface TmcHistoryLocationChangeView {
  id: string;
  itemName: string;
  inventoryNumber: string;
  actorName: string | null;
  beforeLocation: string;
  afterLocation: string;
  comment: string | null;
  occurredAt: string;
}

export function toTmcHistoryPageView(history: TmcTransferHistoryDto): {
  requests: TmcHistoryRequestView[];
  locationChanges: TmcHistoryLocationChangeView[];
} {
  return {
    requests: history.requests.map((request) => ({
      id: request.id,
      initiator: {
        id: request.initiator.id,
        fullName: request.initiator.fullName,
      },
      recipient: {
        id: request.recipient.id,
        fullName: request.recipient.fullName,
      },
      status: request.status,
      createdAt: request.createdAt,
      overdue: request.overdue,
      summary: { total: request.summary.total },
      items: request.items.map(({ item }) => ({
        item: {
          id: item.id,
          name: item.name,
          inventoryNumber: item.inventoryNumber,
          location: {
            buildingId: item.location.buildingId,
            buildingName: item.location.buildingName,
            roomId: item.location.roomId,
            roomDesignation: item.location.roomDesignation,
          },
        },
      })),
    })),
    locationChanges: history.locationChanges.map((change) => ({
      id: change.id,
      itemName: change.itemName,
      inventoryNumber: change.inventoryNumber,
      actorName: change.actorName,
      beforeLocation: change.beforeLocation,
      afterLocation: change.afterLocation,
      comment: change.comment,
      occurredAt: change.occurredAt,
    })),
  };
}

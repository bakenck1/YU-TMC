import type {
  TmcTransferItemResult,
  TmcTransferRequestDto,
  TmcTransferRequestStatus,
} from "@/lib/contracts/tmc-operations";

export interface TmcTransferRequestCardItemView {
  id: string;
  item: {
    id: string;
    name: string;
    inventoryNumber: string;
    quantity: number;
    unitPrice: number;
    photoUrl: string | null;
    location: {
      buildingName: string;
      roomDesignation: string;
    };
  };
  responsibleUserProfile: { fullName: string } | null;
  result: TmcTransferItemResult;
  version: number;
}

export interface TmcTransferRequestCardView {
  id: string;
  initiator: { fullName: string; email: string };
  recipient: { fullName: string; email: string };
  status: TmcTransferRequestStatus;
  comment: string | null;
  createdAt: string;
  overdue: boolean;
  version: number;
  summary: {
    total: number;
    pending: number;
    accepted: number;
  };
  items: TmcTransferRequestCardItemView[];
}

export function toTmcTransferRequestCardView(
  request: TmcTransferRequestDto,
): TmcTransferRequestCardView {
  return {
    id: request.id,
    initiator: {
      fullName: request.initiator.fullName,
      email: request.initiator.email,
    },
    recipient: {
      fullName: request.recipient.fullName,
      email: request.recipient.email,
    },
    status: request.status,
    comment: request.comment,
    createdAt: request.createdAt,
    overdue: request.overdue,
    version: request.version,
    summary: {
      total: request.summary.total,
      pending: request.summary.pending,
      accepted: request.summary.accepted,
    },
    items: request.items.map((entry) => ({
      id: entry.id,
      item: {
        id: entry.item.id,
        name: entry.item.name,
        inventoryNumber: entry.item.inventoryNumber,
        quantity: entry.item.quantity,
        unitPrice: entry.item.unitPrice,
        photoUrl: entry.item.photoUrl,
        location: {
          buildingName: entry.item.location.buildingName,
          roomDesignation: entry.item.location.roomDesignation,
        },
      },
      responsibleUserProfile: entry.responsibleUserProfile
        ? { fullName: entry.responsibleUserProfile.fullName }
        : null,
      result: entry.result,
      version: entry.version,
    })),
  };
}

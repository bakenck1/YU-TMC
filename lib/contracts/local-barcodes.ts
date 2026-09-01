export type LocalBarcodeStatus = "active" | "cancelled";

export interface LocalBarcodeLocationDto {
  roomId: string;
  roomDesignation: string;
  buildingId: string;
  buildingName: string;
}

export interface LocalBarcodeResponsibleDto {
  id: string;
  fullName: string;
}

export interface LocalBarcodeGroupDto {
  id: string;
  itemId: string;
  itemName: string;
  originalBarcode: string;
  itemType: string;
  brand: string | null;
  model: string | null;
  description: string | null;
  unitPrice: number;
  photoUrl: string | null;
  localBarcode: string;
  parentGroupId: string | null;
  quantity: number;
  responsible: LocalBarcodeResponsibleDto;
  previousResponsible: LocalBarcodeResponsibleDto | null;
  location: LocalBarcodeLocationDto;
  transferredAt: string;
  status: LocalBarcodeStatus;
  version: number;
  cancellation: null | {
    reason: string;
    cancelledAt: string;
    administrator: LocalBarcodeResponsibleDto;
  };
}

export interface LocalBarcodeDistributionDto {
  itemId: string;
  itemName: string;
  originalBarcode: string;
  originalQuantity: number;
  originalVersion: number;
  originalRemainder: number;
  originalResponsible: LocalBarcodeResponsibleDto | null;
  originalLocation: LocalBarcodeLocationDto;
  groups: LocalBarcodeGroupDto[];
}

export interface LocalBarcodeHistoryEventDto {
  id: string;
  type: "created" | "transferred" | "split" | "cancelled";
  occurredAt: string;
  actor: LocalBarcodeResponsibleDto;
  fromResponsible: LocalBarcodeResponsibleDto | null;
  toResponsible: LocalBarcodeResponsibleDto | null;
  quantity: number;
  location: LocalBarcodeLocationDto;
  reason: string | null;
}

export interface CreateLocalBarcodeTransferInput {
  itemId: string;
  sourceGroupId: string | null;
  recipientUserId: string;
  quantity: number;
  sourceVersion: number;
  comment?: string | null;
}

export interface CancelLocalBarcodeInput {
  version: number;
  reason: string;
}

export interface LocalBarcodeTransferResultDto {
  group: LocalBarcodeGroupDto;
  createdNewCode: boolean;
}

import type {
  ConnectionStatus,
  ItemCondition,
  QrFormat,
  QrStatus,
  QrTargetKind,
  RecordStatus,
  ItemStatus,
} from "@/lib/contracts/inventory-domain";

export type QrResolutionStatus =
  | "resolved"
  | "revoked"
  | "unissued_system_code"
  | "cancelled"
  | "unknown";

export interface QrResolutionDto {
  status: QrResolutionStatus;
  canonicalKey: string;
  format: QrFormat;
  qrStatus: QrStatus | null;
  target: {
    kind: QrTargetKind;
    id: string;
    status: RecordStatus | ItemStatus;
    title: string;
    buildingName?: string;
    roomDesignation?: string;
      inventoryNumber?: string;
      responsibleName?: string | null;
      responsibleId?: string | null;
      isAssigned: boolean;
      isCurrentUserResponsible?: boolean;
      itemDetails?: {
        itemType: string;
        brand: string | null;
        model: string | null;
        description: string | null;
        quantity: number;
        unitPrice: number;
        condition: ItemCondition;
        connectionStatus: ConnectionStatus;
        photoUrl: string | null;
        createdAt: string;
      };
      localGroup?: {
        id: string;
        localBarcode: string;
        originalBarcode: string;
        quantity: number;
        version: number;
        transferredAt: string;
        status: "active" | "cancelled";
        previousResponsible: {
          id: string;
          fullName: string;
        } | null;
      };
  } | null;
  distribution?: import("@/lib/contracts/local-barcodes").LocalBarcodeDistributionDto;
}

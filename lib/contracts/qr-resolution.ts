import type {
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
  } | null;
}

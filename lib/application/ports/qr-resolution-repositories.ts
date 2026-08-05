import type {
  ItemStatus,
  QrFormat,
  QrStatus,
  QrTargetKind,
  RecordStatus,
} from "@/lib/contracts/inventory-domain";

export interface QrResolutionRecord {
  canonicalKey: string;
  format: QrFormat;
  qrStatus: QrStatus;
  targetKind: QrTargetKind;
  targetId: string;
  targetStatus: RecordStatus | ItemStatus;
  title: string;
  buildingName: string | null;
  roomDesignation: string | null;
  inventoryNumber: string | null;
  responsibleName: string | null;
  responsibleUserId?: string | null;
}

export interface QrResolutionRepository {
  findByCanonicalKey(canonicalKey: string): Promise<QrResolutionRecord | null>;
  findItemByBarcode(
    barcodeValue: string,
    inventoryNumberKey: string,
    fallbackKey: string | null,
  ): Promise<QrResolutionRecord | null>;
}

export interface QrResolutionRepositories {
  qr: QrResolutionRepository;
}

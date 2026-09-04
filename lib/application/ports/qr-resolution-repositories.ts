import type {
  ConnectionStatus,
  ItemCondition,
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
  itemType?: string | null;
  itemBrand?: string | null;
  itemModel?: string | null;
  itemDescription?: string | null;
  itemQuantity?: number | null;
  itemUnitPrice?: number | null;
  itemCondition?: ItemCondition | null;
  itemConnectionStatus?: ConnectionStatus | null;
  itemHasPhoto?: boolean;
  itemCreatedAt?: Date | null;
}

export interface QrResolutionRepository {
  findByCanonicalKey(canonicalKey: string): Promise<QrResolutionRecord | null>;
  findItemByBarcode(
    barcodeValue: string,
    inventoryNumberKey: string,
    fallbackKey: string | null,
  ): Promise<QrResolutionRecord | null>;
  findItemPhoto?(itemId: string): Promise<{
    bytes: Uint8Array;
    mimeType: "image/jpeg";
  } | null>;
}

export interface QrResolutionRepositories {
  qr: QrResolutionRepository;
}

/** Materials are separate from fixed assets; prices and quantities retain decimal precision. */
export type OneCMaterial = {
  externalId: string | null;
  code: string;
  name: string;
  warehouseExternalId: string | null;
  warehouseCode: string | null;
  warehouseName: string | null;
  /** Source-side MOL fields, never automatic Inventory user assignments. */
  responsibleName?: string;
  responsibleExternalId?: string;
  responsibleCode?: string;
  accountCode?: string;
  /** Version 2 tracks account and responsible person as balance dimensions. */
  balanceSchemaVersion?: 2;
  inventoryNumber: string | null;
  barcode: string | null;
  unit: string | null;
  quantity: string;
  unitPrice: string | null;
  currency: "KZT";
};

export type OneCMaterialsSnapshot = { snapshotAt: string; materials: OneCMaterial[]; replaceLegacyBalances?: true };
export type OneCMaterialsImportMetadata = { sourceSha256: string; requestId: string; sourceFilename: string | null };
export type OneCMaterialsImportResult = { received: number; created: number; updated: number; unchanged: number; batchId: string; replayed?: boolean };

/** Codes are exact strings; neither names nor barcode prefixes establish accounting identity. */
export function materialWarehouseKey(material: Pick<OneCMaterial, "warehouseCode" | "warehouseExternalId">): string {
  return material.warehouseCode ? `code:${material.warehouseCode}`
    : material.warehouseExternalId ? `guid:${material.warehouseExternalId}` : "unspecified";
}

export function materialResponsibleKey(material: Pick<OneCMaterial, "balanceSchemaVersion" | "responsibleCode" | "responsibleExternalId">): string {
  if (material.balanceSchemaVersion !== 2) return "unspecified";
  return material.responsibleCode ? `code:${material.responsibleCode}`
    : material.responsibleExternalId ? `guid:${material.responsibleExternalId}` : "unspecified";
}

export function materialIdentityKey(material: Pick<OneCMaterial, "code" | "warehouseCode" | "warehouseExternalId" | "balanceSchemaVersion" | "accountCode" | "responsibleCode" | "responsibleExternalId">): string {
  const warehouse = materialWarehouseKey(material);
  // Legacy packets must keep their original keys for source-hash replay compatibility.
  return material.balanceSchemaVersion === 2
    ? JSON.stringify([material.code, warehouse, "v2", material.accountCode, materialResponsibleKey(material)])
    : JSON.stringify([material.code, warehouse]);
}

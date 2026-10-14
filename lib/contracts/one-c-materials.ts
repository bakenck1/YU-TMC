/** Materials are separate from fixed assets; prices and quantities retain decimal precision. */
export type OneCMaterial = {
  externalId: string | null;
  code: string;
  name: string;
  warehouseExternalId: string | null;
  warehouseCode: string | null;
  warehouseName: string | null;
  inventoryNumber: string | null;
  barcode: string | null;
  unit: string | null;
  quantity: string;
  unitPrice: string | null;
  currency: "KZT";
};

export type OneCMaterialsSnapshot = { snapshotAt: string; materials: OneCMaterial[] };
export type OneCMaterialsImportMetadata = { sourceSha256: string; requestId: string; sourceFilename: string | null };
export type OneCMaterialsImportResult = { received: number; created: number; updated: number; unchanged: number; batchId: string; replayed?: boolean };

/** Codes are exact strings; neither names nor barcode prefixes establish accounting identity. */
export function materialIdentityKey(material: Pick<OneCMaterial, "code" | "warehouseCode" | "warehouseExternalId">): string {
  const warehouse = material.warehouseCode ? `code:${material.warehouseCode}`
    : material.warehouseExternalId ? `guid:${material.warehouseExternalId}` : "unspecified";
  return JSON.stringify([material.code, warehouse]);
}

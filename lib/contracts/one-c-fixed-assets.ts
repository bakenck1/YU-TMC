export type OneCFixedAsset = {
  externalId: string; code: string | null; inventoryNumber: string | null;
  barcode: string | null; name: string; category: string | null;
  location: string | null; status: string | null; responsibleName: string | null;
  responsibleExternalId: string | null; quantity: number; residualCost: number | null;
  acceptedAt: string | null; updatedAt: string | null;
};

export type OneCImportResult = { received: number; created: number; updated: number; unchanged: number };

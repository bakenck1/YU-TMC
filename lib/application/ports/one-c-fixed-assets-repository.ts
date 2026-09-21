import type { OneCFixedAsset, OneCImportResult } from "@/lib/contracts/one-c-fixed-assets";

export interface OneCFixedAssetRepository {
  saveBatch(assets: readonly OneCFixedAsset[], metadata?: OneCImportMetadata): Promise<Omit<OneCImportResult, "received">>;
  tryAcquireLease(keyId: string): Promise<OneCImportLease | null>;
}

export type OneCImportMetadata = { sourceSha256: string; requestId: string; sourceFilename?: string | null };

export interface OneCImportLease { release(): Promise<void>; }

export class OneCImportUnavailableError extends Error {
  constructor(readonly code: "import_timeout" | "store_unavailable", options: { cause?: unknown } = {}) {
    super(code, { cause: options.cause });
    this.name = "OneCImportUnavailableError";
  }
}

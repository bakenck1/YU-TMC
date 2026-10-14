import type { OneCMaterialsImportMetadata, OneCMaterialsImportResult, OneCMaterialsSnapshot } from "@/lib/contracts/one-c-materials";

export interface OneCMaterialsRepository {
  saveSnapshot(snapshot: OneCMaterialsSnapshot, metadata: OneCMaterialsImportMetadata): Promise<Omit<OneCMaterialsImportResult, "received">>;
}

export class OneCMaterialsImportError extends Error {
  constructor(
    readonly code: "import_in_progress" | "stale_snapshot" | "snapshot_conflict" | "import_timeout" | "store_unavailable",
    options: { cause?: unknown } = {},
  ) {
    super(code, { cause: options.cause });
    this.name = "OneCMaterialsImportError";
  }
}

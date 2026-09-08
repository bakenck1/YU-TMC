import type { OneCFixedAsset, OneCImportResult } from "@/lib/contracts/one-c-fixed-assets";
import type { OneCFixedAssetRepository } from "@/lib/application/ports/one-c-fixed-assets-repository";

export class OneCFixedAssetImportService {
  constructor(private readonly repository: OneCFixedAssetRepository) {}

  async importBatch(assets: readonly OneCFixedAsset[]): Promise<OneCImportResult> {
    return { received: assets.length, ...await this.repository.saveBatch(assets) };
  }

  tryAcquireLease(keyId: string) {
    return this.repository.tryAcquireLease(keyId);
  }
}

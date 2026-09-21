import type { OneCFixedAsset, OneCImportResult } from "@/lib/contracts/one-c-fixed-assets";
import type { OneCFixedAssetRepository, OneCImportMetadata } from "@/lib/application/ports/one-c-fixed-assets-repository";

export class OneCFixedAssetImportService {
  constructor(private readonly repository: OneCFixedAssetRepository) {}

  async importBatch(assets: readonly OneCFixedAsset[], metadata?: OneCImportMetadata): Promise<OneCImportResult> {
    return { received: assets.length, ...await this.repository.saveBatch(assets, metadata) };
  }

  tryAcquireLease(keyId: string) {
    return this.repository.tryAcquireLease(keyId);
  }
}

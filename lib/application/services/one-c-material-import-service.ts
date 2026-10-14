import type { OneCMaterialsRepository } from "@/lib/application/ports/one-c-materials-repository";
import type { OneCMaterialsImportMetadata, OneCMaterialsImportResult, OneCMaterialsSnapshot } from "@/lib/contracts/one-c-materials";

export class OneCMaterialImportService {
  constructor(private readonly repository: OneCMaterialsRepository) {}

  async importSnapshot(snapshot: OneCMaterialsSnapshot, metadata: OneCMaterialsImportMetadata): Promise<OneCMaterialsImportResult> {
    return { received: snapshot.materials.length, ...await this.repository.saveSnapshot(snapshot, metadata) };
  }
}

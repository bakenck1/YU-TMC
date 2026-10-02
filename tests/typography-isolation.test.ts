import assert from "node:assert/strict";
import test from "node:test";

import type { AssetLossRepositories } from "../lib/application/ports/asset-loss-repository";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { AssetLossService } from "../lib/application/services/asset-loss-service";

test("printing staff cannot read losses or submit financial changes after a role change", async () => {
  const repositories = {
    assetLosses: {
      findActor: async () => { throw new Error("financial repository must not be queried"); },
    },
  } as unknown as AssetLossRepositories;
  const unitOfWork: UnitOfWork<AssetLossRepositories> = {
    read: async (work) => work(repositories),
    transaction: async (work) => work(repositories),
  };
  const service = new AssetLossService(unitOfWork, {
    now: () => new Date("2026-10-02T00:00:00Z"),
    id: () => "11111111-1111-4111-8111-111111111111",
    checksum: () => "checksum",
  });
  const actor = { userId: "11111111-1111-4111-8111-111111111111", role: "typography", sessionVersion: 1 } as const;
  const itemId = "22222222-2222-4222-8222-222222222222";
  await assert.rejects(() => service.list(actor), { kind: "forbidden" });
  await assert.rejects(() => service.create({ itemId }, actor), { kind: "forbidden" });
  await assert.rejects(() => service.submitReceipt(itemId, { bytes: new Uint8Array([1]), width: 1, height: 1, mediaType: "image/jpeg" }, actor), { kind: "forbidden" });
});

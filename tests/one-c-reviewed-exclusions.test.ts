import assert from "node:assert/strict";
import test from "node:test";
import reviewed from "../lib/data/one-c-reviewed-exclusions.json";
import { isOneCExcludedSource, isOneCExcludedAsset } from "../lib/one-c-integration-scope";

test("keeps all 794 approved N and P identities excluded even after renaming", () => {
  assert.equal(reviewed.reviewedPositions, 794);
  assert.equal(reviewed.fixedAssetIds.length + reviewed.materialCodes.length, 794);
  assert.deepEqual(reviewed.batches.map(batch => [batch.list, batch.positions]), [["N", 318], ["P", 476]]);
  assert.equal(reviewed.batches.reduce((sum, batch) => sum + batch.fixedAssets, 0), reviewed.fixedAssetIds.length);
  assert.equal(reviewed.batches.reduce((sum, batch) => sum + batch.materials, 0), reviewed.materialCodes.length);
  assert.equal(new Set(reviewed.nameHashes).size, reviewed.nameHashes.length);
  for (const id of reviewed.fixedAssetIds) assert.equal(isOneCExcludedAsset(id.toUpperCase()), true, id);
  for (const code of reviewed.materialCodes) assert.equal(isOneCExcludedSource("Переименованная позиция", null, code), true, code);
});

test("retains approved power supplies and important equipment", () => {
  for (const name of ["Блок питания", "Блоки питания", "Сервер NAS", "сист.блок Corei3540", "Сейф", "Видеокамера", "Терминал контроля доступа"]) {
    assert.equal(isOneCExcludedSource(name, null, "unreviewed-code"), false, name);
  }
  assert.equal(isOneCExcludedSource("Переименованная позиция", null, "3162"), false, "leading zeros must remain significant");
});

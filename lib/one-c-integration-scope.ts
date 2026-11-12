import { isOneCBook, oneCNonBookSql, oneCInventoryNonBookSql } from "@/lib/one-c-book-scope";
import { isLibraryFundAsset } from "@/lib/one-c-library-fund";
import { isOneCConsumable, oneCConsumableSql } from "@/lib/one-c-consumables";
import { oneCSecondaryExclusionCategory, oneCSecondaryExcludedSql } from "@/lib/one-c-secondary-scope";
import { isReviewedExcludedName, isReviewedExcludedAsset, isReviewedExcludedMaterial, reviewedExcludedNameSql, reviewedExcludedAssetSql, reviewedExcludedMaterialSql } from "@/lib/one-c-reviewed-exclusions";

// Stable identities from the reviewed 12 November export, excluding library assets.
const consumableAssetIds = [
  "03572f65-9e95-11ea-9a1b-002590861d2e",
  "03572f66-9e95-11ea-9a1b-002590861d2e",
  "03572f67-9e95-11ea-9a1b-002590861d2e",
  "2aeff92e-e43c-11ef-aab4-002590861e2d",
  "613daa25-f39d-11e8-b2f2-002522bd9fc7",
  "67632535-0432-11e9-93c3-b8adba5ee8d7",
  "67632536-0432-11e9-93c3-b8adba5ee8d7",
  "67632537-0432-11e9-93c3-b8adba5ee8d7",
  "67632538-0432-11e9-93c3-b8adba5ee8d7",
  "870b05a9-e7be-11e8-ab96-bc5ff4d1c7e0",
  "8ff1a3f2-f2f3-11e8-bc51-002522bd9fc7",
  "8ff1a3f3-f2f3-11e8-bc51-002522bd9fc7",
  "96f969e0-f78d-11e8-9f81-002522bd9fc7",
  "b27cffa8-04d4-11e9-a242-e333f22c5bd7",
  "c0e44e17-e3d7-11e8-beab-bc5ff4d1c7e0",
  "c426bcdd-e8bf-11e8-951e-002522bd9fc7",
  "d895592f-ec33-11ea-9a99-daf44a7f39d0",
  "f03d1469-9e94-11ea-9a1b-002590861d2e",
  "f03d146a-9e94-11ea-9a1b-002590861d2e",
  "f03d1497-9e94-11ea-9a1b-002590861d2e",
];
const assetIds = new Set(consumableAssetIds);
const consumableAssetSql = (expression: string) =>
  `lower(btrim(coalesce(${expression}, ''))) in (${consumableAssetIds.map(id => `'${id}'`).join(",")})`;

export function isOneCExcludedAsset(externalId?: string | null): boolean {
  return isLibraryFundAsset(externalId) || isReviewedExcludedAsset(externalId) || Boolean(externalId && assetIds.has(externalId.trim().toLowerCase()));
}

export function isOneCExcludedSource(name: string, externalId?: string | null, materialCode?: string | null): boolean {
  return isOneCExcludedAsset(externalId) || isReviewedExcludedName(name) || isReviewedExcludedMaterial(materialCode) || isOneCBook(name, externalId) || isOneCConsumable(name) || oneCSecondaryExclusionCategory(name) !== null;
}

export function oneCIncludedSourceSql(nameExpression: string, externalIdExpression?: string, materialCodeExpression?: string): string {
  return `(${oneCNonBookSql(nameExpression, externalIdExpression)} and not (${reviewedExcludedNameSql(nameExpression)}) and not ${oneCConsumableSql(nameExpression)} and not ${oneCSecondaryExcludedSql(nameExpression)}${externalIdExpression ? ` and not (${consumableAssetSql(externalIdExpression)}) and not (${reviewedExcludedAssetSql(externalIdExpression)})` : ""}${materialCodeExpression ? ` and not (${reviewedExcludedMaterialSql(materialCodeExpression)})` : ""})`;
}

export function oneCIncludedInventorySql(alias: string): string {
  return `(${oneCInventoryNonBookSql(alias)} and not (${reviewedExcludedNameSql(`${alias}.name`)}) and not (${reviewedExcludedMaterialSql(`${alias}.one_c_code`)}) and not ${oneCConsumableSql(`${alias}.name`)} and not ${oneCSecondaryExcludedSql(`${alias}.name`)} and not exists (
    select 1 from yu_inventory.item_one_c_links consumable_link
    where consumable_link.item_id=${alias}.id and (${consumableAssetSql("consumable_link.external_id")} or ${reviewedExcludedAssetSql("consumable_link.external_id")})
  ))`;
}

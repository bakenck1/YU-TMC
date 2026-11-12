import { isOneCBook, oneCNonBookSql, oneCInventoryNonBookSql } from "@/lib/one-c-book-scope";
import { isLibraryFundAsset } from "@/lib/one-c-library-fund";
import { isOneCConsumable, oneCConsumableSql } from "@/lib/one-c-consumables";

// Stable identities from the reviewed 12 November export, excluding library assets.
const consumableAssetIds = [
  "d895592f-ec33-11ea-9a99-daf44a7f39d0",
  "96f969e0-f78d-11e8-9f81-002522bd9fc7",
  "2aeff92e-e43c-11ef-aab4-002590861e2d",
];
const assetIds = new Set(consumableAssetIds);
const consumableAssetSql = (expression: string) =>
  `lower(btrim(coalesce(${expression}, ''))) in (${consumableAssetIds.map(id => `'${id}'`).join(",")})`;

export function isOneCExcludedAsset(externalId?: string | null): boolean {
  return isLibraryFundAsset(externalId) || Boolean(externalId && assetIds.has(externalId.trim().toLowerCase()));
}

export function isOneCExcludedSource(name: string, externalId?: string | null): boolean {
  return isOneCExcludedAsset(externalId) || isOneCBook(name, externalId) || isOneCConsumable(name);
}

export function oneCIncludedSourceSql(nameExpression: string, externalIdExpression?: string): string {
  return `(${oneCNonBookSql(nameExpression, externalIdExpression)} and not ${oneCConsumableSql(nameExpression)}${externalIdExpression ? ` and not (${consumableAssetSql(externalIdExpression)})` : ""})`;
}

export function oneCIncludedInventorySql(alias: string): string {
  return `(${oneCInventoryNonBookSql(alias)} and not ${oneCConsumableSql(`${alias}.name`)} and not exists (
    select 1 from yu_inventory.item_one_c_links consumable_link
    where consumable_link.item_id=${alias}.id and ${consumableAssetSql("consumable_link.external_id")}
  ))`;
}

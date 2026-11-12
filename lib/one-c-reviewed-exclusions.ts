import reviewed from "@/lib/data/one-c-reviewed-exclusions.json";
import { libraryFundNameHash, libraryFundNameKeySql } from "@/lib/one-c-library-fund";
import { exactMaterialCode } from "@/lib/one-c-material-code";

const names = new Set(reviewed.nameHashes);
const codes = new Set(reviewed.materialCodes);
const assets = new Set(reviewed.fixedAssetIds);
const literals = (values: string[]) => values.map(value => `'${value.replaceAll("'", "''")}'`).join(",");

export function isReviewedExcludedName(name: string): boolean {
  return names.has(libraryFundNameHash(name));
}

export function isReviewedExcludedAsset(id?: string | null): boolean {
  return Boolean(id && assets.has(id.trim().toLowerCase()));
}

export function isReviewedExcludedMaterial(code?: string | null): boolean {
  const key = exactMaterialCode(code);
  return key !== null && codes.has(key);
}

/** Expressions are trusted columns supplied by source code. Reference values are quoted. */
export function reviewedExcludedNameSql(expression: string): string {
  return `encode(sha256(convert_to(${libraryFundNameKeySql(expression)}, 'UTF8')), 'hex') = any(array[${literals(reviewed.nameHashes)}]::text[])`;
}

export function reviewedExcludedAssetSql(expression: string): string {
  return `lower(btrim(coalesce(${expression}, ''))) = any(array[${literals(reviewed.fixedAssetIds)}]::text[])`;
}

export function reviewedExcludedMaterialSql(expression: string): string {
  return `btrim(normalize(coalesce(${expression}, ''), NFKC)) = any(array[${literals(reviewed.materialCodes)}]::text[])`;
}

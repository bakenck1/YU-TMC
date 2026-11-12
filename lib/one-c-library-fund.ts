import { createHash } from "node:crypto";
import libraryFund from "@/lib/data/one-c-library-fund.json";

const uppercase = "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯӘІҢҒҮҰҚӨҺ";
const lowercase = "абвгдеёжзийклмнопрстуфхцчшщъыьэюяәіңғүұқөһ";
const hashes = new Set(libraryFund.nameHashes);
const assetIds = new Set(libraryFund.fixedAssetIds);

/** Matches the canonical spelling used by the SQL reference lookup, including C locale. */
export function libraryFundNameKey(name: string): string {
  return name.normalize("NFKC")
    .replace(/[А-ЯЁӘІҢҒҮҰҚӨҺ]/gu, letter => lowercase[uppercase.indexOf(letter)])
    .replace(/[A-Z]/gu, letter => letter.toLowerCase())
    .replace(/[ \t\n\r\f\v]+/gu, " ").trim();
}

export function libraryFundNameHash(name: string): string {
  return createHash("sha256").update(libraryFundNameKey(name), "utf8").digest("hex");
}

export function isLibraryFundName(name: string): boolean {
  return hashes.has(libraryFundNameHash(name));
}

export function isLibraryFundAsset(externalId?: string | null): boolean {
  return Boolean(externalId && assetIds.has(externalId.trim().toLowerCase()));
}

export function libraryFundAssetSql(expression: string): string {
  // Rename the reference column so an unqualified outer external_id stays correlated.
  return `exists (select 1 from yu_inventory.one_c_library_fund_assets library_asset(library_external_id) where library_asset.library_external_id=lower(coalesce(${expression}, '')))`;
}

export function libraryFundNameKeySql(expression: string): string {
  const sourceLetters = `${uppercase}ABCDEFGHIJKLMNOPQRSTUVWXYZ`;
  const targetLetters = `${lowercase}abcdefghijklmnopqrstuvwxyz`;
  return `btrim(regexp_replace(translate(normalize(coalesce(${expression}, ''), NFKC), '${sourceLetters}', '${targetLetters}'), '[[:space:]]+', ' ', 'g'))`;
}

export function libraryFundNameSql(expression: string): string {
  const hash = `encode(sha256(convert_to(${libraryFundNameKeySql(expression)}, 'UTF8')), 'hex')`;
  return `exists (select 1 from yu_inventory.one_c_library_fund_names library_fund where library_fund.name_hash=${hash})`;
}

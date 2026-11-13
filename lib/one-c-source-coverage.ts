import type { AuditMatch } from "@/lib/inventory-source-audit";
import type { OneCMaterial } from "@/lib/contracts/one-c-materials";

type MaterialRecord = { key: string; material: Pick<OneCMaterial, "code" | "quantity"> };

/** Reverse reconciliation counts source identities, independently of Inventory cards or units. */
export function summarizeOneCSourceCoverage(
  rows: readonly AuditMatch[],
  assetIds: readonly string[],
  records: readonly MaterialRecord[],
) {
  const seenAssets = new Set(rows.flatMap(row => row.oneC.map(asset => asset.externalId)));
  const seenBalances = new Set(rows.flatMap(row => row.excel.flatMap(material => material.sourceKey ? [material.sourceKey] : [])));
  const assets = new Set(assetIds);
  const balances = new Map(records.filter(row => Number(row.material.quantity) > 0).map(row => [row.key, row.material.code]));
  const codes = new Set(balances.values());
  const codesWithCandidate = new Set([...balances].filter(([key]) => seenBalances.has(key)).map(([, code]) => code));
  const balanceRowsWithCandidate = [...balances.keys()].filter(key => seenBalances.has(key)).length;
  const assetsWithCandidate = [...assets].filter(id => seenAssets.has(id)).length;
  return {
    assets: { total: assets.size, withCandidate: assetsWithCandidate, withoutCandidate: assets.size - assetsWithCandidate },
    materials: {
      total: codes.size, withCandidate: codesWithCandidate.size, withoutCandidate: codes.size - codesWithCandidate.size,
      balanceRows: balances.size, balanceRowsWithoutCandidate: balances.size - balanceRowsWithCandidate,
    },
  };
}

export type OneCSourceCoverage = ReturnType<typeof summarizeOneCSourceCoverage>;

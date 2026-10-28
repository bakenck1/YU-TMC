import type { OneCFixedAsset } from "@/lib/contracts/one-c-fixed-assets";
import type { OneCMaterial } from "@/lib/contracts/one-c-materials";
import type { AuditMatch } from "@/lib/inventory-source-audit";
import { buildInventoryAuditEnrichmentPlan } from "@/lib/inventory-audit-enrichment";
import { addOneCPriceProposals } from "@/lib/one-c-enrichment-price";
import { classifyOneCAudit, oneCAuditDisplayCategory } from "@/lib/one-c-analytics";

type Inventory = { id: string; status: string; quantity: number; oneCCode: string | null; unitPrice?: string | null; responsibleName?: string | null; itemSection?: string };
type SourceAsset = { externalId: string; asset: OneCFixedAsset };

/** One row per real Inventory card, shared by the matched list and the MP export. */
export function getOneCMatchedCards(data: { rows: AuditMatch[]; inventory: Inventory[]; assets: SourceAsset[]; registryAssets?: SourceAsset[]; materialRecords?: { key: string; material: OneCMaterial }[] }) {
  const inventory = new Map(data.inventory.map(item => [item.id, item]));
  const assets = new Map((data.registryAssets ?? data.assets).map(source => [source.externalId, source.asset]));
  const items = data.rows.flatMap(row => {
    const item = inventory.get(row.itemId);
    return item ? [{ ...item, name: row.itemName, inventoryNumber: row.siteNumber, version: row.itemVersion,
      itemSection: item.itemSection ?? "general", unitPrice: item.unitPrice ?? undefined,
      officialBarcodes: row.siteBarcodes.filter(barcode => barcode.kind === "official").map(barcode => barcode.value),
      localBarcodes: row.siteBarcodes.filter(barcode => barcode.kind === "local").map(barcode => barcode.value) }] : [];
  });
  const materials = new Map((data.materialRecords ?? []).map(record => [record.key, record.material]));
  const evidence = data.rows.map(row => {
    const excel = row.excel.map(entry => {
      const material = entry.sourceKey ? materials.get(entry.sourceKey) : undefined;
      return material && material.code === entry.oneCCode ? { ...entry, unitPrice: material.unitPrice } : entry;
    });
    const codes = new Set(excel.map(entry => entry.oneCCode));
    const keys = new Set(excel.map(entry => entry.sourceKey));
    let rowNumber = Math.max(0, ...excel.map(entry => entry.rowNumber));
    for (const { key, material } of data.materialRecords ?? []) {
      if (!codes.has(material.code) || keys.has(key) || !(Number(material.quantity) > 0)) continue;
      excel.push({ rowNumber: ++rowNumber, sourceKind: "materials_api", sourceKey: key, oneCCode: material.code, materialGuid: material.externalId,
        nomenclature: material.name, inventoryNumber: material.inventoryNumber ?? "", explicitInventoryNumber: material.inventoryNumber,
        barcode: material.barcode, responsibleName: material.responsibleName, endingBalance: material.quantity, unitPrice: material.unitPrice });
    }
    return { ...row, excel };
  });
  const plan = buildInventoryAuditEnrichmentPlan(evidence, items, { allowDescriptionIdentity: true, formattedNumbers: true, includeIt: true, allowSourceCode: true });
  addOneCPriceProposals(plan, evidence, assets, items, { independentSources: true });
  const proposals = new Map(plan.rows.map(row => [row.itemId, row]));
  const presence = classifyOneCAudit(data.rows);
  return data.rows.flatMap(row => {
    const confirmed = presence.get(row.itemId)!;
    if (!confirmed.fixedAssets && !confirmed.materials) return [];
    const item = inventory.get(row.itemId);
    if (!item) return [];
    const proposal = proposals.get(row.itemId);
    const price = proposal?.price;
    return [{
      id: row.itemId, name: row.itemName, inventoryNumber: row.siteNumber,
      oneCCode: item?.oneCCode ?? row.siteOneCCode ?? null,
      sourceCodes: [...new Set([...row.oneC.map(source => source.code), ...row.excel.map(source => source.oneCCode)].filter((code): code is string => Boolean(code)))],
      group: oneCAuditDisplayCategory(row, confirmed) === "fixedAssets" ? "assets" as const : "materials" as const,
      source: confirmed.fixedAssets && confirmed.materials ? "ОС + МП" : confirmed.fixedAssets ? "ОС" : "МП",
      responsibleName: item?.responsibleName ?? row.siteResponsibleName ?? null,
      quantity: item?.quantity ?? 0, status: item?.status ?? "",
      currentUnitPrice: item?.unitPrice ?? null,
      oneCUnitPrice: price && (price.status === "ready" || price.status === "unchanged") ? price.nextUnitPrice : null,
      priceStatus: price?.status ?? "unconfirmed", barcode: row.siteBarcodes.map(barcode => barcode.value).join("\n"),
    }];
  });
}

export type OneCMatchedCard = ReturnType<typeof getOneCMatchedCards>[number];

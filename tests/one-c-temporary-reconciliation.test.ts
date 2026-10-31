import assert from "node:assert/strict";
import test from "node:test";
import { buildInventorySourceAudit, type AuditItem, type ExcelSourceRow } from "../lib/inventory-source-audit";
import { buildInventoryAuditEnrichmentPlan } from "../lib/inventory-audit-enrichment";
import { classifyOneCAudit } from "../lib/one-c-analytics";
import { oneCResponsibleNameKey } from "../lib/one-c-responsible-name";
import { temporaryReconciliationPlan } from "../lib/one-c-temporary-reconciliation";
import type { OneCFixedAsset } from "../lib/contracts/one-c-fixed-assets";

const card: AuditItem = { id: "temporary", name: "Шкаф 800*400*2000", inventoryNumber: "TMP-2026-1", inventoryNumberKind: "temporary", oneCCode: null,
  responsibleName: "Иванов Иван Иванович", officialBarcodes: [], sourceCodes: [], version: 1 };
const asset: OneCFixedAsset = { externalId: "asset-guid", code: "000123", name: card.name, inventoryNumber: "011/00134", barcode: null, status: "Принято к учёту",
  responsibleName: card.responsibleName!, quantity: 1, initialCost: 7000, residualCost: null, category: null, location: null, responsibleExternalId: null, acceptedAt: null, updatedAt: null };
const material: ExcelSourceRow = { sourceKind: "materials_api", sourceKey: "balance", materialGuid: "mp-guid", rowNumber: 1, oneCCode: "000456",
  nomenclature: card.name, responsibleName: card.responsibleName, endingBalance: "2", inventoryNumber: "", unitPrice: "5000" };
const options = { exactNames: true, formattedNumbers: true, descriptionBarcodes: true };
const enrichmentOptions = { allowDescriptionIdentity: true, includeIt: true, formattedNumbers: true, allowSourceCode: true };

test("accounting role suffixes do not prevent temporary name+full-owner matches in either register", () => {
  for (const suffix of ["\nМОЛ", "\nосн МОЛ", " (МОЛ)", " (осн. МОЛ)", ", МОЛ"]) {
    assert.equal(oneCResponsibleNameKey(card.responsibleName + suffix), "иванов иван иванович");
    for (const source of ["asset", "material"]) {
      const audit = buildInventorySourceAudit([card], source === "asset" ? [{ externalId: asset.externalId, asset: { ...asset, responsibleName: card.responsibleName + suffix } }] : [],
        source === "material" ? [{ ...material, responsibleName: card.responsibleName + suffix }] : [], [], options);
      const presence = classifyOneCAudit(audit.rows).get(card.id)!;
      assert.equal(presence.fixedAssets || presence.materials, true);
      const plan = buildInventoryAuditEnrichmentPlan(audit.rows, [{ ...card, itemSection: "general" }], enrichmentOptions);
      assert.equal(plan.counts.ready, 1);
      assert.equal(plan.rows[0].identityMethod, "name_owner");
      assert.equal(plan.rows[0].nextCode, source === "asset" ? asset.code : material.oneCCode);
    }
  }
  for (const name of ["Иванов Иван", "Петров Иван Иванович МОЛ", "МОЛ", "осн МОЛ", null]) {
    const audit = buildInventorySourceAudit([card], [{ externalId: asset.externalId, asset: { ...asset, responsibleName: name } }], [], [], options);
    assert.equal(classifyOneCAudit(audit.rows).get(card.id)?.fixedAssets, false);
  }
});

test("persisted GUID confirms presence and permits enrichment without replacing the temporary number", () => {
  const audit = buildInventorySourceAudit([card], [{ externalId: asset.externalId, asset: { ...asset, name: "Название из 1С", responsibleName: null } }], [],
    [{ externalId: asset.externalId, itemId: card.id }], options);
  assert.equal(classifyOneCAudit(audit.rows).get(card.id)?.fixedAssets, true);
  const plan = buildInventoryAuditEnrichmentPlan(audit.rows, [{ ...card, itemSection: "general" }], enrichmentOptions);
  assert.equal(plan.counts.ready, 1);
  assert.equal(plan.rows[0].identityMethod, "saved_link");
  assert.equal(plan.rows[0].nextCode, asset.code);
  assert.equal(plan.rows[0].siteNumber, card.inventoryNumber);
  const conflicting = { ...card, oneCCode: "different-saved-code" };
  const evidence = buildInventorySourceAudit([conflicting], [{ externalId: asset.externalId, asset }], [], [{ externalId: asset.externalId, itemId: card.id }], options);
  assert.equal(buildInventoryAuditEnrichmentPlan(evidence.rows, [{ ...conflicting, itemSection: "general" }], enrichmentOptions).rows[0].reason, "code_conflict");
});

test("temporary review excludes official cards and recomputes all apply counts", () => {
  const official = { ...card, id: "official", inventoryNumberKind: "official", inventoryNumber: asset.inventoryNumber!, oneCCode: asset.code };
  const missing = { ...card, id: "missing", name: "Другая карточка", responsibleName: null };
  const audit = buildInventorySourceAudit([card, official, missing], [{ externalId: asset.externalId, asset }], [], [], options);
  const plan = buildInventoryAuditEnrichmentPlan(audit.rows, [card, official, missing].map(item => ({ ...item, itemSection: "general" })), enrichmentOptions);
  const temporary = temporaryReconciliationPlan(plan, audit.rows);
  assert.deepEqual(temporary.rows.map(row => row.itemId).sort(), [card.id, missing.id].sort());
  assert.equal(temporary.rows.find(row => row.itemId === card.id)?.temporaryMatch?.found, true);
  assert.equal(temporary.rows.find(row => row.itemId === missing.id)?.temporaryMatch?.found, false);
  assert.equal(temporary.rows.find(row => row.itemId === missing.id)?.reason, "sources_missing");
  assert.equal(Object.values(temporary.counts).reduce((sum, count) => sum + count, 0), 2);
  assert.equal(plan.rows.length, 3);
});

import { parseCode39ScanInput } from "@/lib/domain/code39";
import { extractExcelInventoryReferences, extractFormattedInventoryReferences, extractSourceBarcodeNumbers, inventoryAuditNumberKey, inventoryAuditSpacelessKey, inventoryAuditNumbersEqual, inventoryAuditItemNameNumbers } from "@/lib/inventory-audit-numbers";
import type { AuditMatch, ExcelSourceRow } from "@/lib/inventory-source-audit";
import { exactMaterialCode, isTemporaryOneCCard } from "@/lib/one-c-material-code";
import { oneCSourceNameKey } from "@/lib/one-c-source-name";

export type InventoryAuditEnrichmentItem = {
  id: string;
  name: string;
  inventoryNumber: string;
  officialBarcodes: readonly string[];
  localBarcodes?: readonly string[];
  oneCCode: string | null;
  version: number;
  itemSection: string;
  archivedAt?: string | Date | null;
  quantity?: number;
  unitPrice?: string;
  status?: string;
};

export type InventoryAuditEnrichmentReason = "confirmed" | "unchanged" | "item_not_found" | "item_ineligible" | "item_changed" | "sources_missing" | "source_ambiguous" | "source_reused" | "code_missing" | "code_invalid" | "code_conflict" | "identity_conflict" | "identity_missing" | "name_invalid" | "shared_number_conflict";

export type InventoryAuditEnrichmentRow = {
  itemId: string;
  itemVersion: number;
  currentName: string;
  currentCode: string | null;
  nextName: string;
  nextCode: string | null;
  eligible: boolean;
  changed: boolean;
  reason: InventoryAuditEnrichmentReason;
  nameSource?: "1c" | "excel" | "materials_api";
  codeStatus?: "confirmed" | "code_missing" | "code_invalid";
  missingSources?: Array<"1c" | "excel">;
  externalId?: string;
  excelRowNumber?: number;
  siteNumber?: string;
  identityEvidence?: string;
  identityMethod?: "material_code" | "asset_code";
  searchText?: string;
  sourceDetails?: Array<{ kind: "ОС" | "МП"; name: string; inventoryNumber: string | null; barcode: string | null }>;
  price?: {
    currentUnitPrice: string; nextUnitPrice: string; changed: boolean;
    status: "ready" | "unchanged" | "missing" | "invalid" | "ambiguous" | "unconfirmed";
    source?: "os_initial_cost" | "material_unit_price";
    sourceExternalId?: string;
    sourceMaterialCode?: string | null;
  };
  responsibility?: {
    currentUserId: string | null; currentName: string | null; nextUserId: string | null; nextName: string | null;
    changed: boolean; status: "ready" | "unchanged" | "not_allowed" | "ambiguous" | "user_missing" | "user_ambiguous" | "pending_transfer" | "unavailable" | "unconfirmed";
    sourceName?: string;
  };
};

export type InventoryAuditEnrichmentPlan = {
  rows: InventoryAuditEnrichmentRow[];
  counts: { ready: number; unchanged: number; skipped: number };
};

function code(value: string | null | undefined): string | null {
  const normalized = value?.normalize("NFKC").trim();
  return normalized || null;
}

function number(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = inventoryAuditNumberKey(value);
  if (!key || /^(?:tmp-|yui-)/iu.test(key)) return null;
  return inventoryAuditSpacelessKey(key) ?? key;
}

function barcode(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = parseCode39ScanInput(value);
  return parsed.ok ? parsed.fallbackKey ? null : number(parsed.inventoryNumber) : number(value);
}

function oneCSourceSnapshot(source: AuditMatch["oneC"][number]): string {
  // A rejected claim must not disappear beside an absent field in another copy.
  const claim = (value: string | null, normalized: string | null) => value == null ? null : normalized ?? value.normalize("NFKC").trim();
  return JSON.stringify([code(source.code), claim(source.inventoryNumber, number(source.inventoryNumber)),
    claim(source.barcode, barcode(source.barcode)), source.name.trim()]);
}

/** Removing one slash is allowed only when its boundary is not contradicted elsewhere. */
function agrees(left: string, right: string): boolean {
  if (left === right) return true;
  const withSlash = left.includes("/") ? left : right;
  const withoutSlash = left.includes("/") ? right : left;
  return /^\d+\/\d+$/u.test(withSlash) && /^\d+$/u.test(withoutSlash)
    && withSlash.replace("/", "") === withoutSlash;
}

function allAgree(values: readonly string[], anchor: string): boolean {
  return values.every((value) => agrees(value, anchor))
    && values.every((value, index) => values.slice(index + 1).every((other) => agrees(value, other)));
}

function officialSnapshot(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => inventoryAuditNumberKey(value)))].sort();
}

function sameOfficialSnapshot(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(officialSnapshot(left)) === JSON.stringify(officialSnapshot(right));
}

function descriptionNumbers(value: string, formattedNumbers = false): string[] {
  // A model number in free text is not an identity claim. Explicit inventory
  // markers are checked, including their unabridged range/suffix evidence.
  return [...extractExcelInventoryReferences(value), ...(formattedNumbers ? extractFormattedInventoryReferences(value) : [])].filter((reference) => !reference.numberIsUnmarked)
    .flatMap((reference) => [reference.inventoryNumber, reference.sourceInventoryNumber])
    .map(number).filter((value): value is string => Boolean(value));
}

function excelNumbers(row: ExcelSourceRow): string[] {
  return [row.inventoryNumber, row.sourceInventoryNumber, row.matchedInventoryNumber,
    ...[...(row.inventoryReferences ?? []), ...(row.matchedReference ? [row.matchedReference] : [])]
      .flatMap((reference) => [reference.inventoryNumber, reference.sourceInventoryNumber])]
    .map(number).filter((value): value is string => Boolean(value));
}

function own(map: Map<string, Set<string>>, key: string, itemId: string): void {
  const owners = map.get(key) ?? new Set<string>();
  owners.add(itemId);
  map.set(key, owners);
}

function identityIssue(item: InventoryAuditEnrichmentItem, identities: string[], description: string,
  sourceBarcode?: string | null, descriptionBarcodes = false, structuredNumber?: string | null, formattedNumbers = false): "identity_missing" | "identity_conflict" | null {
  const anchor = identities[0];
  if (!anchor) return "identity_missing";
  const claims = [...identities, ...descriptionNumbers(description, formattedNumbers), ...(descriptionBarcodes ? extractSourceBarcodeNumbers(description).map(number).filter((value): value is string => value !== null) : [])];
  const siteNumber = number(item.inventoryNumber);
  const officialBarcodes = [...item.officialBarcodes, ...(formattedNumbers ? item.localBarcodes ?? [] : [])].map(barcode).filter((value): value is string => Boolean(value));
  const nameNumbers = formattedNumbers ? inventoryAuditItemNameNumbers(item.name).map(number).filter((value): value is string => value !== null) : [];
  const siteIdentities = [siteNumber, ...officialBarcodes].filter((value): value is string => Boolean(value));
  if (descriptionBarcodes) {
    const equal = formattedNumbers ? inventoryAuditNumbersEqual : agrees;
    // A source identifier may match the site's number, a barcode or a number
    // in its name. Every additional source claim must still identify this card.
    const sourceNumber = number(structuredNumber);
    const siteAnchors = [siteNumber, ...officialBarcodes, ...nameNumbers].filter((value): value is string => value !== null);
    if (structuredNumber?.trim() && (!sourceNumber || !siteAnchors.some(value => equal(sourceNumber, value)))) return "identity_conflict";
    if (sourceBarcode?.trim()) {
      const sourceValue = barcode(sourceBarcode);
      if (!sourceValue || !siteAnchors.some(value => equal(value, sourceValue))) return "identity_conflict";
    }
    return claims.every(claim => siteAnchors.some(value => equal(value, claim)))
      ? null : "identity_conflict";
  }
  if (!allAgree(claims, anchor) || !siteIdentities.some((identity) => allAgree([...claims, identity], anchor))
    || (siteNumber && !allAgree([...claims, siteNumber], anchor))) return "identity_conflict";
  if (sourceBarcode) {
    const normalized = barcode(sourceBarcode);
    if (!normalized || !officialBarcodes.some((value) => agrees(value, normalized))) return "identity_conflict";
  }
  return null;
}

function descriptionIdentity(item: InventoryAuditEnrichmentItem, description: string, formattedNumbers = false): string[] {
  const anchors = [number(item.inventoryNumber), ...item.officialBarcodes.map(barcode), ...(formattedNumbers ? [...(item.localBarcodes ?? []).map(barcode), ...inventoryAuditItemNameNumbers(item.name).map(number)] : [])].filter((value): value is string => Boolean(value));
  return [...new Set([
    ...extractExcelInventoryReferences(description).map(ref => number(ref.sourceInventoryNumber ?? ref.inventoryNumber)),
    ...extractSourceBarcodeNumbers(description).map(number),
    ...(formattedNumbers ? extractFormattedInventoryReferences(description).map(ref => number(ref.inventoryNumber)) : []),
  ].filter((value): value is string => value !== null && anchors.some(anchor => formattedNumbers ? inventoryAuditNumbersEqual(anchor, value) : anchor === value)))];
}

/** Plans existing-card updates without mutating either live data or saved evidence. */
export function buildInventoryAuditEnrichmentPlan(auditRows: readonly AuditMatch[], items: readonly InventoryAuditEnrichmentItem[], options: { allowDescriptionIdentity?: boolean; includeIt?: boolean; formattedNumbers?: boolean; allowTemporaryMaterialCode?: boolean; allowTemporaryAssetCode?: boolean; allowSourceCode?: boolean; priceOnly?: boolean } = {}): InventoryAuditEnrichmentPlan {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const oneCOwners = new Map<string, Set<string>>();
  const excelOwners = new Map<string, Set<string>>();
  const auditRowCount = new Map<string, number>();
  for (const row of auditRows) {
    auditRowCount.set(row.itemId, (auditRowCount.get(row.itemId) ?? 0) + 1);
    for (const source of row.oneC) own(oneCOwners, source.externalId, row.itemId);
    for (const source of row.excel) own(excelOwners, String(source.rowNumber), row.itemId);
  }
  const counts = { ready: 0, unchanged: 0, skipped: 0 };
  const rows = auditRows.map((row): InventoryAuditEnrichmentRow => {
    const item = itemsById.get(row.itemId);
    const result: InventoryAuditEnrichmentRow = {
      itemId: row.itemId, itemVersion: item?.version ?? row.itemVersion,
      currentName: item?.name ?? row.itemName, currentCode: item?.oneCCode ?? null,
      nextName: item?.name ?? row.itemName, nextCode: item?.oneCCode ?? null,
      eligible: false, changed: false, reason: "sources_missing",
      ...(options.allowDescriptionIdentity ? {
        siteNumber: row.siteNumber,
        sourceDetails: [...new Map([
          ...row.oneC.map(entry => ({ kind: "ОС" as const, name: entry.name, inventoryNumber: entry.inventoryNumber, barcode: entry.barcode })),
          ...row.excel.map(entry => ({ kind: "МП" as const, name: entry.nomenclature, inventoryNumber: entry.explicitInventoryNumber ?? null, barcode: entry.barcode ?? null })),
        ].map(entry => [JSON.stringify(entry), entry])).values()],
        searchText: [row.siteNumber, ...row.siteBarcodes.map(entry => entry.value),
          ...row.oneC.flatMap(entry => [entry.name, entry.code, entry.inventoryNumber, entry.barcode]),
          ...row.excel.flatMap(entry => [entry.nomenclature, entry.oneCCode, entry.inventoryNumber, entry.barcode])].filter(Boolean).join("\n"),
      } : {}),
    };
    const skip = (reason: InventoryAuditEnrichmentReason) => {
      result.reason = reason;
      counts.skipped++;
      return result;
    };
    if (!item) return skip("item_not_found");
    if (item.archivedAt || (item.status !== undefined && item.status !== "active") || (item.itemSection !== "general" && !(options.includeIt && item.itemSection === "it"))) return skip("item_ineligible");
    if (item.version !== row.itemVersion || item.name !== row.itemName
      || inventoryAuditNumberKey(item.inventoryNumber) !== inventoryAuditNumberKey(row.siteNumber)
      || !sameOfficialSnapshot(item.officialBarcodes, row.siteBarcodes.filter((entry) => entry.kind === "official").map((entry) => entry.value))) return skip("item_changed");
    if (auditRowCount.get(item.id) !== 1) return skip("source_ambiguous");
    if (options.formattedNumbers && !sameOfficialSnapshot(item.localBarcodes ?? [], row.siteBarcodes.filter(entry => entry.kind === "local").map(entry => entry.value))) return skip("item_changed");
    const materialCode = options.allowSourceCode || (options.allowTemporaryMaterialCode || options.allowTemporaryAssetCode) && isTemporaryOneCCard(row.numberKind, row.siteNumber) ? exactMaterialCode(item.oneCCode) : null;
    const codeMaterials = materialCode && (options.allowSourceCode || options.allowTemporaryMaterialCode) ? row.excel.filter(entry => entry.sourceKind === "materials_api" && exactMaterialCode(entry.oneCCode) === materialCode && Number(entry.endingBalance) > 0) : [];
    const codeAssets = materialCode && (options.allowSourceCode || options.allowTemporaryAssetCode) ? row.oneC.filter(entry => exactMaterialCode(entry.code) === materialCode && entry.origins?.some(origin => origin === "current_registry" || origin === "selected_batch")) : [];
    const useMaterialCode = codeMaterials.length > 0;
    const useAssetCode = codeAssets.length > 0;
    if ((useMaterialCode || useAssetCode) && exactMaterialCode(row.siteOneCCode) !== materialCode) return skip("item_changed");
    // The two registers may reuse a code for different property. Presence in
    // both is reported, but updates must not silently pick one register.
    if (useMaterialCode && useAssetCode) return skip("source_ambiguous");
    const materialEvidence = useMaterialCode ? codeMaterials : row.excel;
    const oneC = (useAssetCode ? codeAssets : useMaterialCode ? [] : row.oneC).filter((entry) => Array.isArray(entry.origins)
      && entry.origins.some((origin) => origin === "selected_batch" || origin === "current_registry"));
    if (!oneC.length && !row.excel.length) {
      result.missingSources = ["1c", "excel"];
      return skip("sources_missing");
    }
    // Multiple selected/current copies are safe only if their entire identity
    // and proposed values agree. Different source identities are never ranked.
    const distinct = new Map<string, AuditMatch["oneC"][number]>();
    for (const entry of oneC) {
      const existing = distinct.get(entry.externalId);
      if (existing && oneCSourceSnapshot(existing) !== oneCSourceSnapshot(entry)) return skip("source_ambiguous");
      distinct.set(entry.externalId, entry);
    }
    if (distinct.size > 1) return skip("source_ambiguous");
    const source = [...distinct.values()][0];
    const nameCanIdentifyPrice = (sourceName: string, exactName: boolean) => options.priceOnly && exactName
      && oneCSourceNameKey(item.name) !== null && oneCSourceNameKey(item.name) === oneCSourceNameKey(sourceName);
    const hasSiteIdentity = Boolean(number(item.inventoryNumber) || [...item.officialBarcodes, ...(item.localBarcodes ?? [])].some(value => barcode(value)) || inventoryAuditItemNameNumbers(item.name).length);
    let excel: ExcelSourceRow | undefined;
    let name: string;
    let codeOnlyIdentity = false;
    if (source) {
      if (!source.externalId) return skip("source_ambiguous");
      const byName = nameCanIdentifyPrice(source.name, source.matchedBy.includes("exact_name"));
      const reused = (oneCOwners.get(source.externalId)?.size ?? 0) > 1;
      if (!useAssetCode && !byName && reused) return skip("source_reused");
      let identities = [number(source.inventoryNumber), barcode(source.barcode)].filter((value): value is string => Boolean(value));
      if (!identities.length && options.allowDescriptionIdentity && !source.inventoryNumber?.trim() && !source.barcode?.trim()) identities = descriptionIdentity(item, source.name, options.formattedNumbers);
      const issue = identityIssue(item, identities, source.name, source.barcode, options.allowDescriptionIdentity, source.inventoryNumber, options.formattedNumbers);
      if (issue && !useAssetCode && !(byName && (issue === "identity_missing" || !hasSiteIdentity))) return skip(issue);
      codeOnlyIdentity = Boolean(useAssetCode && (issue || reused));
      name = source.name.trim();
    } else {
      // Absence permits fallback; unsafe or ambiguous 1C evidence never does.
      const materialRows = materialEvidence.filter(entry => entry.sourceKind === "materials_api");
      // Repeated MOL/account balances are one nomenclature, but names/codes/number claims must agree.
      if (materialRows.length && materialRows.length === materialEvidence.length) {
        const signatures = new Set(materialRows.map(entry => JSON.stringify([
          entry.materialGuid ?? null, entry.oneCCode ?? null, options.priceOnly ? null : entry.nomenclature,
          ...(useMaterialCode || options.priceOnly ? [] : [[...new Set(excelNumbers(entry))].sort(), entry.barcode ?? null]),
        ])));
        if (signatures.size !== 1) return skip("source_ambiguous");
      } else if (materialEvidence.length !== 1) return skip("source_ambiguous");
      const materialIdentityIssue = (entry: ExcelSourceRow) => {
        let identities = entry.sourceKind === "materials_api"
          ? [number(entry.explicitInventoryNumber), barcode(entry.barcode)].filter((value): value is string => Boolean(value))
          : excelNumbers(entry);
        if (!identities.length && options.allowDescriptionIdentity && !entry.explicitInventoryNumber?.trim() && !entry.barcode?.trim()) identities = descriptionIdentity(item, entry.nomenclature, options.formattedNumbers);
        return identityIssue(item, identities, entry.nomenclature, entry.sourceKind === "materials_api" ? entry.barcode : null, options.allowDescriptionIdentity, entry.explicitInventoryNumber, options.formattedNumbers);
      };
      excel = options.priceOnly ? materialEvidence.find(entry => {
        const issue = materialIdentityIssue(entry);
        return !issue || useMaterialCode || nameCanIdentifyPrice(entry.nomenclature, Boolean(entry.matchedBy?.includes("exact_name"))) && (issue === "identity_missing" || !hasSiteIdentity);
      }) ?? materialEvidence[0] : materialEvidence[0];
      if (!Number.isSafeInteger(excel.rowNumber) || excel.rowNumber < 1) return skip("source_ambiguous");
      const byName = nameCanIdentifyPrice(excel.nomenclature, Boolean(excel.matchedBy?.includes("exact_name")));
      const reused = materialEvidence.some(entry => (excelOwners.get(String(entry.rowNumber))?.size ?? 0) > 1);
      if (!useMaterialCode && !byName && reused) return skip("source_reused");
      const issue = materialIdentityIssue(excel);
      if (issue && !useMaterialCode && !(byName && (issue === "identity_missing" || !hasSiteIdentity))) return skip(issue);
      codeOnlyIdentity = Boolean(useMaterialCode && (issue || reused));
      name = excel.nomenclature.trim();
    }
    if (!name || [...name].length > 160 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(name)) {
      if (!options.priceOnly) return skip("name_invalid");
      name = item.name;
    }
    // Name and code come from the same identified source, with 1C priority.
    // A missing/invalid preferred code never erases the saved code or borrows Excel's.
    const chosenCode = code(source ? source.code : excel?.oneCCode);
    const codeStatus = !chosenCode ? "code_missing"
      : chosenCode.length > 64 || /[\u0000-\u001f\u007f]/u.test(chosenCode) ? "code_invalid" : "confirmed";
    const nextCode = codeStatus === "confirmed" ? chosenCode : item.oneCCode;
    result.nameSource = source ? "1c" : excel?.sourceKind === "materials_api" ? "materials_api" : "excel";
    result.codeStatus = codeStatus;
    result.externalId = source?.externalId;
    result.excelRowNumber = excel?.rowNumber;
    if (useMaterialCode && codeOnlyIdentity) result.identityMethod = "material_code";
    if (useAssetCode && codeOnlyIdentity) result.identityMethod = "asset_code";
    if (options.allowDescriptionIdentity) {
      result.siteNumber = item.inventoryNumber;
      result.identityEvidence = useMaterialCode || useAssetCode ? `1C: ${materialCode}` : source?.inventoryNumber || source?.barcode || excel?.explicitInventoryNumber || excel?.barcode || descriptionIdentity(item, name, options.formattedNumbers).join(", ");
    }
    result.nextName = name;
    result.nextCode = nextCode;
    result.eligible = true;
    result.changed = item.name !== name || item.oneCCode !== nextCode;
    result.reason = result.changed ? "confirmed" : "unchanged";
    if (result.changed) counts.ready++; else counts.unchanged++;
    return result;
  });
  return { rows, counts };
}

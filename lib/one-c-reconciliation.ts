import { createHash } from "node:crypto";

import type { OneCFixedAsset } from "@/lib/contracts/one-c-fixed-assets";
import {
  inventoryNumberComparisonKey,
  parseCode39ScanInput,
} from "@/lib/domain/code39";

export type OneCAssetKind = "physical_movable" | "non_physical";
export type OneCNonPhysicalReason =
  | "real_estate"
  | "software"
  | "documentation"
  | "accounting_adjustment";

export type OneCAssetClassification = {
  readonly kind: OneCAssetKind;
  readonly reason: OneCNonPhysicalReason | null;
};

export type OneCIssueCode =
  | "non_physical_asset"
  | "missing_inventory_number"
  | "missing_room"
  | "unsupported_item_type"
  | "negative_residual_value"
  | "zero_residual_value_unconfirmed"
  | "quantity_requires_review"
  | "responsible_unassigned"
  | "accounting_status_requires_review"
  | "invalid_one_c_barcode"
  | "identifier_conflict";

export type OneCIssue = {
  readonly code: OneCIssueCode;
  readonly severity: "warning" | "blocking" | "excluded";
};

export type OneCInventoryCandidate = {
  readonly id: string;
  readonly inventoryNumber: string;
  /** Official values from barcode_registry. Local barcodes are deliberately excluded. */
  readonly officialBarcodes?: readonly string[];
};

export type OneCIdentifierMatchStatus =
  | "match_ok"
  | "strong_candidate"
  | "inventory_candidate"
  | "barcode_conflict"
  | "inventory_number_conflict"
  | "linked_number_changed"
  | "possible_match"
  | "new_candidate"
  | "ambiguous_conflict";

export type OneCIdentifierMatch = {
  readonly status: OneCIdentifierMatchStatus;
  readonly itemId: string | null;
  readonly inventoryItemIds: readonly string[];
  readonly barcodeItemIds: readonly string[];
  readonly possibleItemIds: readonly string[];
  readonly barcodeState: "missing" | "matched" | "unknown" | "invalid";
  readonly blocking: boolean;
};

export type OneCAnalysisResult =
  | "linked_exact_guid"
  | "candidate_inventory_number"
  | "conflict_inventory_number"
  | "new_publishable"
  | "blocked_missing_inventory_number"
  | "blocked_missing_room"
  | "blocked_unsupported_type"
  | "excluded_non_physical"
  | "manual_review";

const NON_PHYSICAL_RULES: readonly [OneCNonPhysicalReason, RegExp][] = [
  ["accounting_adjustment", /(?:корректиров|бухгалтерск(?:ая|ие|ий)\s+(?:запись|коррек))/u],
  ["software", /(?:программн(?:ое|ого)\s+обеспеч|\bпо\b|лицензи)/u],
  ["documentation", /(?:документац|проектн(?:ая|ой)\s+док|техническ(?:ая|ой)\s+док)/u],
  ["real_estate", /(?:недвижим|земельн(?:ый|ого)\s+участ|здани|сооружени|помещени)/u],
];

export function classifyOneCFixedAsset(
  asset: Pick<OneCFixedAsset, "name" | "category">,
): OneCAssetClassification {
  const searchable = `${asset.category ?? ""} ${asset.name}`
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU");
  for (const [reason, pattern] of NON_PHYSICAL_RULES) {
    if (pattern.test(searchable)) return { kind: "non_physical", reason };
  }
  return { kind: "physical_movable", reason: null };
}

/** A deliberately lossy key used only to offer a possible match, never to link. */
export function softInventoryNumberComparisonKey(value: string): string {
  return inventoryNumberComparisonKey(value).replace(/[\s/\\_.-]+/gu, "");
}

export function matchOneCFixedAssetIdentifiers(
  asset: Pick<OneCFixedAsset, "inventoryNumber" | "barcode">,
  options: {
    readonly items: readonly OneCInventoryCandidate[];
    readonly linkedItemId?: string | null;
  },
): OneCIdentifierMatch {
  const linkedItemId = options.linkedItemId ?? null;
  const inventoryNumber = asset.inventoryNumber?.trim() ?? "";
  const exactKey = inventoryNumber ? inventoryNumberComparisonKey(inventoryNumber) : "";
  const inventoryItemIds = uniqueSorted(
    exactKey
      ? options.items
          .filter((item) => inventoryNumberComparisonKey(item.inventoryNumber) === exactKey)
          .map((item) => item.id)
      : [],
  );

  const barcode = parseOneCBarcode(asset.barcode);
  const barcodeItemIds = barcode.state === "valid"
    ? uniqueSorted(options.items.filter((item) =>
        (item.officialBarcodes ?? []).some((value) => barcodeComparisonKey(value) === barcode.key),
      ).map((item) => item.id))
    : [];
  const possibleItemIds = !inventoryItemIds.length && exactKey
    ? uniqueSorted(options.items.filter((item) =>
        softInventoryNumberComparisonKey(item.inventoryNumber) === softInventoryNumberComparisonKey(inventoryNumber),
      ).map((item) => item.id))
    : [];
  const barcodeState: OneCIdentifierMatch["barcodeState"] =
    barcode.state === "missing" ? "missing"
      : barcode.state === "invalid" ? "invalid"
        : barcodeItemIds.length ? "matched" : "unknown";

  const result = (status: OneCIdentifierMatchStatus, itemId: string | null): OneCIdentifierMatch => ({
    status,
    itemId,
    inventoryItemIds,
    barcodeItemIds,
    possibleItemIds,
    barcodeState,
    blocking: status === "barcode_conflict"
      || status === "inventory_number_conflict"
      || status === "ambiguous_conflict",
  });

  if (inventoryItemIds.length > 1 || barcodeItemIds.length > 1) {
    return result("ambiguous_conflict", null);
  }
  const inventoryItemId = inventoryItemIds[0] ?? null;
  const barcodeItemId = barcodeItemIds[0] ?? null;
  if (inventoryItemId && barcodeItemId && inventoryItemId !== barcodeItemId) {
    return result("barcode_conflict", null);
  }

  if (linkedItemId) {
    if (barcodeItemId && barcodeItemId !== linkedItemId) return result("barcode_conflict", linkedItemId);
    if (inventoryItemId && inventoryItemId !== linkedItemId) {
      return result("inventory_number_conflict", linkedItemId);
    }
    if (inventoryItemId === linkedItemId && (!barcodeItemId || barcodeItemId === linkedItemId)) {
      return result("match_ok", linkedItemId);
    }
    if (!inventoryItemId && barcodeItemId === linkedItemId) {
      return result("inventory_number_conflict", linkedItemId);
    }
    if (!inventoryItemId && barcode.state === "missing") {
      return result("linked_number_changed", linkedItemId);
    }
    return result("barcode_conflict", linkedItemId);
  }

  if (inventoryItemId) {
    if (barcode.state === "missing") return result("inventory_candidate", inventoryItemId);
    if (barcodeItemId === inventoryItemId) return result("strong_candidate", inventoryItemId);
    return result("barcode_conflict", inventoryItemId);
  }
  if (barcodeItemId) return result("inventory_number_conflict", barcodeItemId);
  if (possibleItemIds.length) return result("possible_match", possibleItemIds.length === 1 ? possibleItemIds[0] : null);
  return result("new_candidate", null);
}

export function analyzeOneCFixedAsset(
  asset: OneCFixedAsset,
  options: {
    readonly items?: readonly OneCInventoryCandidate[];
    readonly linkedItemId?: string | null;
    readonly selectedRoomId?: string | null;
    readonly selectedItemType?: string | null;
    readonly zeroResidualValueConfirmed?: boolean;
    readonly emptyResponsibleConfirmed?: boolean;
  } = {},
): {
  readonly classification: OneCAssetClassification;
  readonly identifiers: OneCIdentifierMatch;
  readonly result: OneCAnalysisResult;
  readonly issues: readonly OneCIssue[];
} {
  const classification = classifyOneCFixedAsset(asset);
  const identifiers = matchOneCFixedAssetIdentifiers(asset, {
    items: options.items ?? [],
    linkedItemId: options.linkedItemId,
  });
  const issues: OneCIssue[] = [];
  if (classification.kind === "non_physical") issues.push(issue("non_physical_asset", "excluded"));
  if (!asset.inventoryNumber?.trim()) issues.push(issue("missing_inventory_number", "blocking"));
  if (asset.residualCost !== null && asset.residualCost < 0) issues.push(issue("negative_residual_value", "blocking"));
  if (asset.residualCost === 0 && !options.zeroResidualValueConfirmed) {
    issues.push(issue("zero_residual_value_unconfirmed", "warning"));
  }
  if (!Number.isFinite(asset.quantity) || asset.quantity <= 0 || asset.quantity > 1) {
    issues.push(issue("quantity_requires_review", "blocking"));
  }
  if (!asset.responsibleExternalId && !asset.responsibleName?.trim() && !options.emptyResponsibleConfirmed) {
    issues.push(issue("responsible_unassigned", "warning"));
  }
  if (asset.status === "Снято с учёта" || asset.status === "Не в учёте") {
    issues.push(issue("accounting_status_requires_review", "blocking"));
  }
  if (identifiers.barcodeState === "invalid") issues.push(issue("invalid_one_c_barcode", "blocking"));
  if (identifiers.blocking) issues.push(issue("identifier_conflict", "blocking"));

  const isNew = identifiers.status === "new_candidate";
  if (isNew && !options.selectedRoomId) issues.push(issue("missing_room", "blocking"));
  if (isNew && !options.selectedItemType) issues.push(issue("unsupported_item_type", "blocking"));

  let result: OneCAnalysisResult;
  if (classification.kind === "non_physical") result = "excluded_non_physical";
  else if (!asset.inventoryNumber?.trim()) result = "blocked_missing_inventory_number";
  else if (identifiers.blocking) result = "conflict_inventory_number";
  else if (isNew && !options.selectedRoomId) result = "blocked_missing_room";
  else if (isNew && !options.selectedItemType) result = "blocked_unsupported_type";
  else if (issues.some((entry) => entry.severity === "blocking") || identifiers.status === "possible_match") result = "manual_review";
  else if (identifiers.status === "match_ok") result = "linked_exact_guid";
  else if (identifiers.status === "strong_candidate" || identifiers.status === "inventory_candidate") result = "candidate_inventory_number";
  else if (isNew) result = "new_publishable";
  else result = "manual_review";

  return { classification, identifiers, result, issues };
}

export type OneCPublicationAction = "create" | "link" | "update" | "exclude" | "blocked" | "conflict";

export type OneCPublicationPlanRow = {
  readonly externalId: string;
  readonly action: OneCPublicationAction;
  readonly itemId?: string | null;
  readonly itemVersion?: string | number | null;
  readonly decisionVersion?: string | number | null;
  readonly inventoryNumber?: string | null;
  readonly barcode?: string | null;
};

export type OneCPublicationPlan = {
  readonly batchId: string;
  readonly sourceHash: string;
  readonly existingItemsVersion: string;
  readonly create: number;
  readonly link: number;
  readonly update: number;
  readonly exclude: number;
  readonly blocked: number;
  readonly conflicts: number;
  readonly rows: readonly OneCPublicationPlanRow[];
  readonly hash: string;
};

export function buildOneCPublicationPlan(input: {
  readonly batchId: string;
  readonly sourceHash: string;
  readonly existingItemsVersion: string;
  readonly rows: readonly OneCPublicationPlanRow[];
}): OneCPublicationPlan {
  const seenExternalIds = new Set<string>();
  const rows = [...input.rows]
    .map((row) => normalizePlanRow(row))
    .sort((left, right) => left.externalId.localeCompare(right.externalId, "en"));
  for (const row of rows) {
    if (seenExternalIds.has(row.externalId)) throw new RangeError("duplicate_external_id");
    seenExternalIds.add(row.externalId);
  }

  const duplicateNumberRows = duplicateOwners(rows, (row) =>
    row.inventoryNumber ? inventoryNumberComparisonKey(row.inventoryNumber) : null,
  );
  const duplicateBarcodeRows = duplicateOwners(rows, (row) => barcodeComparisonKey(row.barcode));
  const checkedRows = rows.map((row) =>
    duplicateNumberRows.has(row.externalId) || duplicateBarcodeRows.has(row.externalId)
      ? { ...row, action: "conflict" as const }
      : row,
  );
  const counts = { create: 0, link: 0, update: 0, exclude: 0, blocked: 0, conflicts: 0 };
  for (const row of checkedRows) {
    if (row.action === "conflict") counts.conflicts += 1;
    else counts[row.action] += 1;
  }
  const content = {
    batchId: input.batchId,
    sourceHash: input.sourceHash,
    existingItemsVersion: input.existingItemsVersion,
    ...counts,
    rows: checkedRows,
  };
  return { ...content, hash: sha256CanonicalJson(content) };
}

export function sha256CanonicalJson(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function normalizePlanRow(row: OneCPublicationPlanRow): OneCPublicationPlanRow {
  const externalId = row.externalId.normalize("NFKC").trim().toLocaleLowerCase("en-US");
  if (!externalId) throw new RangeError("external_id_required");
  return {
    externalId,
    action: row.action,
    itemId: row.itemId ?? null,
    itemVersion: row.itemVersion ?? null,
    decisionVersion: row.decisionVersion ?? null,
    inventoryNumber: row.inventoryNumber?.normalize("NFKC").trim() || null,
    barcode: row.barcode?.normalize("NFKC").trim() || null,
  };
}

function duplicateOwners(
  rows: readonly OneCPublicationPlanRow[],
  keyOf: (row: OneCPublicationPlanRow) => string | null,
): Set<string> {
  const owners = new Map<string, string[]>();
  for (const row of rows) {
    if (row.action === "exclude" || row.action === "blocked" || row.action === "conflict") continue;
    const key = keyOf(row);
    if (!key) continue;
    owners.set(key, [...(owners.get(key) ?? []), row.externalId]);
  }
  return new Set([...owners.values()].filter((ids) => ids.length > 1).flat());
}

function parseOneCBarcode(value: string | null | undefined):
  | { readonly state: "missing" }
  | { readonly state: "invalid" }
  | { readonly state: "valid"; readonly key: string } {
  if (!value?.trim()) return { state: "missing" };
  const parsed = parseCode39ScanInput(value);
  if (!parsed.ok) return { state: "invalid" };
  return { state: "valid", key: parsed.fallbackKey
    ? `fallback:${parsed.fallbackKey}`
    : `inventory:${inventoryNumberComparisonKey(parsed.inventoryNumber)}` };
}

function barcodeComparisonKey(value: string | null | undefined): string | null {
  const parsed = parseOneCBarcode(value);
  return parsed.state === "valid" ? parsed.key : null;
}

function issue(code: OneCIssueCode, severity: OneCIssue["severity"]): OneCIssue {
  return { code, severity };
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

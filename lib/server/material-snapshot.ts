import "server-only";

import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { ApplicationError } from "@/lib/domain/application-error";
import { inventoryNumberComparisonKey } from "@/lib/domain/code39";
import { extractExcelInventoryReference, type ExcelSourceRow } from "@/lib/inventory-source-audit";

export const MAX_MATERIAL_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const OLE_HEADER = Buffer.from("d0cf11e0a1b11ae1", "hex");

export function parseMaterialSnapshot(bytes: Buffer, options: { allowEmpty?: boolean } = {}): { sha256: string; accepted: ExcelSourceRow[]; skipped: number } {
  if (bytes.length < OLE_HEADER.length || bytes.length > MAX_MATERIAL_SNAPSHOT_BYTES || !bytes.subarray(0, OLE_HEADER.length).equals(OLE_HEADER)) {
    throw new ApplicationError("validation", "invalid_material_snapshot_file");
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex").toUpperCase();
  let workbook: XLSX.WorkBook;
  try { workbook = XLSX.read(bytes, { type: "buffer", cellFormula: false, cellHTML: false, cellStyles: false, bookVBA: false, cellDates: false }); }
  catch { throw new ApplicationError("validation", "invalid_material_snapshot_file"); }
  if (!Array.isArray(workbook.SheetNames) || workbook.SheetNames.length !== 1) throw new ApplicationError("validation", "material_snapshot_sheet_mismatch");
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new ApplicationError("validation", "material_snapshot_sheet_mismatch");
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
  if (range.s.r !== 0 || range.s.c !== 0 || range.e.r > 65_535 || range.e.c > 255) throw new ApplicationError("validation", "invalid_material_snapshot_file");
  const lines = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, blankrows: true });
  const headerIndex = lines.findIndex((line, index) => index < 50 && line?.[1] === "Номенклатура" && line?.[4] === "Код" && line?.[11] === "Количество");
  if (headerIndex < 0) throw new ApplicationError("validation", "material_snapshot_columns_mismatch");
  const accepted: ExcelSourceRow[] = [];
  let skipped = 0;
  for (let index = headerIndex + 1; index < lines.length; index++) {
    const line = lines[index] ?? [];
    if (!/^\d{1,3}(?:,\d{3})*$|^\d+$/u.test(String(line[0] ?? "").trim())) continue;
    const nomenclature = String(line[1] ?? "").trim();
    if (nomenclature.length > 1_000 || String(line[11] ?? "").length > 100) throw new ApplicationError("validation", "invalid_material_snapshot_file");
    const reference = extractExcelInventoryReference(nomenclature);
    if (!reference || !inventoryNumberComparisonKey(reference.inventoryNumber)) { skipped++; continue; }
    accepted.push({ rowNumber: index + 1, nomenclature, ...reference, endingBalance: line[11] == null ? null : String(line[11]) });
  }
  if (!accepted.length && !options.allowEmpty) throw new ApplicationError("validation", "material_snapshot_no_inventory_numbers");
  return { sha256, accepted, skipped };
}

/** Rebuilds search data from immutable private bytes, verifying the stored source identity. */
export function parseStoredMaterialSnapshot(row: { source_file: unknown; sha256: unknown; byte_size: unknown }) {
  if (!Buffer.isBuffer(row.source_file) || row.source_file.length !== Number(row.byte_size)) {
    throw new ApplicationError("unavailable", "material_snapshot_integrity_mismatch");
  }
  const actualHash = createHash("sha256").update(row.source_file).digest("hex");
  if (actualHash !== String(row.sha256).toLowerCase()) throw new ApplicationError("unavailable", "material_snapshot_integrity_mismatch");
  // A stricter parser may reject every old number. Keep the upload screen accessible
  // and let the next audit report no Excel matches without accepting a new empty file.
  return parseMaterialSnapshot(row.source_file, { allowEmpty: true });
}

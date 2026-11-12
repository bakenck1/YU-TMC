import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { isOneCBook } from "../lib/one-c-book-scope";
import { isOneCExcludedSource } from "../lib/one-c-integration-scope";
import { oneCConsumableCategory } from "../lib/one-c-consumables";

type Source = { source: "OS" | "MP"; row: number; name: string; code: string; quantity: number; unit: string; id: string; account: string };
const [input, destination] = process.argv.slice(2);
if (!input || !destination) throw new Error("Usage: node --import tsx scripts/review-one-c-scope.ts <export.xlsx> <output-directory>");
const bytes = readFileSync(input);
const workbook = XLSX.read(bytes, { type: "buffer" });
const records: Source[] = [];
const text = (value: unknown) => String(value ?? "").trim();
for (const source of ["OS", "MP"] as const) {
  const sheetName = source === "OS" ? "Основные средства" : "МП";
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Missing source sheet: ${sheetName}`);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
  const headers = rows[4];
  if (!headers) throw new Error(`Missing headers: ${sheetName}`);
  const column = (name: string) => { const i = headers.indexOf(name); if (i < 0) throw new Error(`Missing ${name} in ${sheetName}`); return i; };
  const name = column("Наименование"), code = column("Код 1С"), id = column("GUID 1С");
  const quantity = column(source === "OS" ? "Количество" : "Остаток");
  const kind = source === "MP" ? column("Тип строки") : -1;
  const status = source === "OS" ? column("Статус") : -1;
  const unit = source === "MP" ? column("Единица") : -1;
  const account = source === "MP" ? column("Счёт") : -1;
  for (let i = 5; i < rows.length; i++) {
    const row = rows[i];
    if (source === "MP" && row[kind] !== "Остаток 1С") continue;
    if (source === "OS" && row[status] !== "Принято к учёту") continue;
    if (source === "MP" && !(Number(row[quantity]) > 0)) continue;
    if (!text(row[name]) || !text(row[code])) throw new Error(`Missing name or code: ${sheetName}!${i + 1}`);
    const count = Number(row[quantity]);
    if (!Number.isFinite(count)) throw new Error(`Invalid quantity: ${sheetName}!${i + 1}`);
    records.push({ source, row: i + 1, name: text(row[name]), code: text(row[code]), quantity: count,
      id: text(row[id]), unit: unit < 0 ? "" : text(row[unit]), account: account < 0 ? "" : text(row[account]) });
  }
}
const identity = (r: Source) => r.source === "OS" ? r.id : r.code;
const sourceId = (r: Source) => r.source === "OS" ? r.id : undefined;
const book = (r: Source) => isOneCBook(r.name, sourceId(r));
const reason = (r: Source) => book(r) ? "library" : oneCConsumableCategory(r.name) ?? "confirmed_consumable";
const excluded = records.filter(r => isOneCExcludedSource(r.name, sourceId(r)));
const remaining = records.filter(r => !isOneCExcludedSource(r.name, sourceId(r)));
const scopeSummary = (rows: Source[]) => ({
  assets: new Set(rows.filter(r => r.source === "OS").map(identity)).size,
  materials: new Set(rows.filter(r => r.source === "MP").map(identity)).size,
  rows: rows.length,
});
const materialsByCode = new Map<string, Source[]>();
for (const r of records.filter(r => r.source === "MP")) materialsByCode.set(r.code, [...(materialsByCode.get(r.code) ?? []), r]);
const mixedCodes = [...materialsByCode].filter(([, rows]) => new Set(rows.map(r => isOneCExcludedSource(r.name))).size > 1)
  .map(([code, rows]) => ({ code, names: [...new Set(rows.map(r => r.name))] }));
const categories = Object.fromEntries([...new Set(excluded.map(reason))].sort().map(key => [key, scopeSummary(excluded.filter(r => reason(r) === key))]));
const summary = { sourceFile: path.basename(input), sourceSha256: createHash("sha256").update(bytes).digest("hex"),
  original: scopeSummary(records), excluded: scopeSummary(excluded), remaining: scopeSummary(remaining), categories, mixedCodes };
mkdirSync(destination, { recursive: true });
writeFileSync(path.join(destination, "records.json"), JSON.stringify(records, null, 2));
writeFileSync(path.join(destination, "summary.json"), JSON.stringify(summary, null, 2));
writeFileSync(path.join(destination, "excluded.json"), JSON.stringify(excluded.map(r => ({ ...r, reason: reason(r) })), null, 2));
writeFileSync(path.join(destination, "remaining.json"), JSON.stringify(remaining, null, 2));
const escape = (s: string) => s.replaceAll("|", "\\|").replace(/[\r\n]+/g, " ");
const lines = ["# Проверка состава интеграции 1С", "", `Источник: ${summary.sourceFile}`, `SHA-256: ${summary.sourceSha256}`, "",
  "ОС: только на учёте. МП: только строки «Остаток 1С» с положительным остатком. Строки наших карточек из листа МП повторно не считаются.", "",
  "| Состав | ОС (GUID) | МП (коды) | Строк источника |", "|---|---:|---:|---:|",
  ...([['До исключений', summary.original], ['Исключено', summary.excluded], ['Осталось', summary.remaining]] as const).map(([label, s]) => `| ${label} | ${s.assets} | ${s.materials} | ${s.rows} |`), "",
  "Коды и строки остатков — разные показатели. Количество единиц не складывается между различными единицами измерения.", "",
  "| Причина | ОС | Кодов МП | Строк |", "|---|---:|---:|---:|", ...Object.entries(categories).map(([key, s]) => `| ${key} | ${s.assets} | ${s.materials} | ${s.rows} |`), "",
  "## Исключённые позиции", "", "| Раздел | Код | Наименование | Ед. | Количество | Строка Excel | Причина |", "|---|---|---|---|---:|---:|---|",
  ...excluded.map(r => `| ${r.source === "OS" ? "ОС" : "МП"} | ${r.code} | ${escape(r.name)} | ${escape(r.unit)} | ${r.quantity} | ${r.row} | ${reason(r)} |`)];
writeFileSync(path.join(destination, "review.md"), lines.join("\n") + "\n");
console.log(JSON.stringify(summary, null, 2));
if (mixedCodes.length) throw new Error("Some material codes have conflicting scope: inspect summary.json before publishing counts");

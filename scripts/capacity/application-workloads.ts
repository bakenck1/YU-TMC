import { createHash } from "node:crypto";

import type { InventoryItemDto } from "../../lib/contracts/inventory-items";
import { exportInventoryItems } from "../../lib/server/excel/inventory-excel";
import { parseOneCFixedAssets } from "../../lib/server/integrations/one-c-fixed-assets";

export async function measureApplicationWorkloads(config: {
  applicationWorkloads: { xmlRecords: number; exportRows: number };
  load: { samples: number; warmups: number };
  sloMs: Record<string, number>;
}) {
  const xml = syntheticXml(config.applicationWorkloads.xmlRecords);
  const items = syntheticItems(config.applicationWorkloads.exportRows);
  const xmlParse = await sample(config, () => { parseOneCFixedAssets(xml); });
  const exportWorkbook = await sample(config, async () => { await exportInventoryItems(items, "Capacity baseline"); });
  return {
    xml_parse: {
      ...xmlParse,
      records: config.applicationWorkloads.xmlRecords,
      inputBytes: Buffer.byteLength(xml),
      fingerprint: createHash("sha256").update("parseOneCFixedAssets:capacity-v1").digest("hex"),
      sloMs: config.sloMs.xml_parse,
    },
    export_workbook: {
      ...exportWorkbook,
      records: config.applicationWorkloads.exportRows,
      fingerprint: createHash("sha256").update("exportInventoryItems:capacity-v1").digest("hex"),
      sloMs: config.sloMs.export_workbook,
    },
  };
}

async function sample(config: { load: { samples: number; warmups: number } }, action: () => void | Promise<void>) {
  const samples: number[] = [];
  const rssBefore = process.memoryUsage().rss;
  let peakRss = rssBefore;
  for (let index = 0; index < config.load.warmups + config.load.samples; index += 1) {
    const started = performance.now();
    await action();
    const elapsed = performance.now() - started;
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
    if (index >= config.load.warmups) samples.push(elapsed);
  }
  const rssAfter = process.memoryUsage().rss;
  return {
    samplesMs: samples.map(round), p50Ms: percentile(samples, 0.5), p95Ms: percentile(samples, 0.95),
    rssBeforeMiB: round(rssBefore / 1024 / 1024), rssAfterMiB: round(rssAfter / 1024 / 1024),
    peakRssMiB: round(peakRss / 1024 / 1024), peakGrowthMiB: round((peakRss - rssBefore) / 1024 / 1024),
  };
}

function syntheticXml(count: number) {
  const rows = Array.from({ length: count }, (_, index) => {
    const suffix = String(index + 1).padStart(12, "0");
    return `<FixedAsset><ExternalId>00000000-0000-4000-8000-${suffix}</ExternalId><Code>CAP-${index + 1}</Code><InventoryNumber>CAP-INV-${index + 1}</InventoryNumber><Name>Synthetic Asset ${index + 1}</Name><Quantity>${index % 5 + 1}</Quantity><ResidualCost>${index + 100}</ResidualCost><UpdatedAt>2026-09-09</UpdatedAt></FixedAsset>`;
  }).join("");
  return `<FixedAssets>${rows}</FixedAssets>`;
}

function syntheticItems(count: number): InventoryItemDto[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    name: `Synthetic Asset ${index + 1}`,
    description: "Synthetic capacity record",
    category: "electronics",
    itemType: "electronics",
    brand: "Synthetic Brand",
    model: `Model ${index % 100}`,
    quantity: index % 5 + 1,
    unitPrice: index + 100,
    inventoryNumberKind: "official",
    inventoryNumber: `CAP-INV-${index + 1}`,
    room: { id: "00000000-0000-4000-8000-000000000001", designation: `R-${index % 250}`, floorNumber: index % 10, buildingId: "00000000-0000-4000-8000-000000000001", buildingName: `Synthetic Building ${index % 25}` },
    status: "active",
    condition: "good",
    connectionStatus: "not_applicable",
    qrCode: null,
    responsible: { id: "00000000-0000-4000-8000-000000000002", name: `Synthetic User ${index % 5000}` },
    photoUrl: null,
    version: 1,
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
    archivedAt: null,
  }));
}

function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return round(sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0);
}

function round(value: number) { return Math.round(value * 100) / 100; }

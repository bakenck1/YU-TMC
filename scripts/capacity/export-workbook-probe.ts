import { exportInventoryItems } from "../../lib/server/excel/inventory-excel";
import { syntheticItems } from "./application-workloads";

void main();

async function main() {
  const rowCount = Number(process.argv[2]);
  if (!Number.isSafeInteger(rowCount) || rowCount < 1) {
    throw new Error("Export memory probe requires a positive row count");
  }

  const items = syntheticItems(rowCount);
  const rssBefore = process.memoryUsage().rss;
  const peakBaselineRss = maxRssBytes();
  const started = performance.now();
  const output = await exportInventoryItems(items, "Capacity baseline");
  const elapsedMs = performance.now() - started;

  process.stdout.write(JSON.stringify({
    elapsedMs,
    rssBefore,
    rssAfter: process.memoryUsage().rss,
    peakBaselineRss,
    peakRss: maxRssBytes(),
    outputBytes: output.byteLength,
  }));
}

function maxRssBytes() {
  return process.resourceUsage().maxRSS * 1024;
}

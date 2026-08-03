import assert from "node:assert/strict";
import test from "node:test";

import {
  filteredDashboard,
  type AnalyticsDashboardData,
} from "../lib/analytics-dashboard";

const records = [
  { id: "a", name: "Monitor", qrCode: "A", itemType: "Equipment", brandModel: "HP", location: "Main / 101", building: "Main", responsible: "User", quantity: 2, price: 200, createdAt: "2026-07-10T00:00:00.000Z", status: "active", hasPhoto: true },
  { id: "b", name: "Desk", qrCode: "B", itemType: "Furniture", brandModel: "", location: "Annex / 201", building: "Annex", responsible: "-", quantity: 1, price: 50, createdAt: "2026-08-01T00:00:00.000Z", status: "maintenance", hasPhoto: false },
];
const dashboard = {
  records,
  summary: { totalItems: 2, targetItems: 10, totalValue: 250, assigned: 1, withPhoto: 1, completion: 20 },
  types: [], brands: [], objects: [], locations: [], statuses: [], valueByType: [], responsibles: [],
} satisfies AnalyticsDashboardData;

test("analytics filters rebuild every dataset from the same filtered records", () => {
  const filtered = filteredDashboard(dashboard, {
    building: "Main",
    itemType: "Equipment",
    dateFrom: "2026-07-01",
    dateTo: "2026-07-31",
  });
  assert.deepEqual(filtered.records.map((record) => record.id), ["a"]);
  assert.deepEqual(filtered.summary, { totalItems: 1, targetItems: 10, totalValue: 200, assigned: 1, withPhoto: 1, completion: 10 });
  assert.equal(filtered.types[0]?.value, 2);
  assert.equal(filtered.objects[0]?.name, "Main");
  assert.equal(filtered.statuses[0]?.name, "active");
  assert.equal(filtered.valueByType[0]?.value, 200);
});

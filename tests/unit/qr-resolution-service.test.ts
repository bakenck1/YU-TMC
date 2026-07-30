import { describe, expect, it } from "vitest";

import type {
  QrResolutionRecord,
  QrResolutionRepositories,
  QrResolutionRepository,
} from "@/lib/application/ports/qr-resolution-repositories";
import type { UnitOfWork } from "@/lib/application/ports/unit-of-work";
import { QrResolutionService } from "@/lib/application/services/qr-resolution-service";

const ADMIN = { userId: "admin-1", role: "admin" as const };
const TECHNICIAN = { userId: "tech-1", role: "warehouse" as const };
const EMPLOYEE = { userId: "employee-1", role: "employee" as const };
const GENERATED = "YUQ1:00000000000000000000000000";

describe("QrResolutionService", () => {
  it("resolves generated and legacy values through one canonical key", async () => {
    const harness = createHarness({
      canonicalKey: GENERATED,
      format: "generated_v1",
      qrStatus: "active",
      targetKind: "item",
      targetId: "item-1",
      targetStatus: "active",
      title: "Ноутбук",
      buildingName: "Корпус A",
      roomDesignation: "D212",
      inventoryNumber: "TMP-2026-000001",
      responsibleName: null,
    });
    await expect(harness.service.resolve(GENERATED.toLowerCase(), TECHNICIAN)).resolves.toMatchObject({
      status: "resolved",
      canonicalKey: GENERATED,
      target: { kind: "item", title: "Ноутбук" },
    });
  });

  it("does not disclose non-item targets to an employee", async () => {
    const harness = createHarness({
      canonicalKey: "legacy-building",
      format: "legacy_raw",
      qrStatus: "active",
      targetKind: "building",
      targetId: "building-1",
      targetStatus: "active",
      title: "Корпус A",
      buildingName: null,
      roomDesignation: null,
      inventoryNumber: null,
      responsibleName: null,
    });
    await expect(
      harness.service.resolve("legacy-building", EMPLOYEE),
    ).rejects.toMatchObject({ kind: "not_found", publicCode: "not_accessible" });
  });

  it("does not disclose the current responsible person to an employee", async () => {
    const harness = createHarness({
      canonicalKey: "legacy-item",
      format: "legacy_raw",
      qrStatus: "active",
      targetKind: "item",
      targetId: "item-1",
      targetStatus: "active",
      title: "Laptop",
      buildingName: "Building A",
      roomDesignation: "D212",
      inventoryNumber: "INV-1",
      responsibleName: "Private owner",
    });
    await expect(harness.service.resolve("legacy-item", EMPLOYEE)).resolves.toMatchObject({
      target: { kind: "item", responsibleName: undefined },
    });
  });

  it("does not disclose a revoked item QR to an employee", async () => {
    const harness = createHarness({
      canonicalKey: "legacy-revoked-item",
      format: "legacy_raw",
      qrStatus: "revoked",
      targetKind: "item",
      targetId: "item-1",
      targetStatus: "active",
      title: "Laptop",
      buildingName: "Building A",
      roomDesignation: "D212",
      inventoryNumber: "INV-1",
      responsibleName: null,
    });

    await expect(
      harness.service.resolve("legacy-revoked-item", EMPLOYEE),
    ).rejects.toMatchObject({ kind: "not_found", publicCode: "not_accessible" });
  });

  it("does not disclose an inactive item to an employee", async () => {
    const harness = createHarness({
      canonicalKey: "legacy-inactive-item",
      format: "legacy_raw",
      qrStatus: "active",
      targetKind: "item",
      targetId: "item-1",
      targetStatus: "decommissioned",
      title: "Laptop",
      buildingName: "Building A",
      roomDesignation: "D212",
      inventoryNumber: "INV-1",
      responsibleName: null,
    });

    await expect(
      harness.service.resolve("legacy-inactive-item", EMPLOYEE),
    ).rejects.toMatchObject({ kind: "not_found", publicCode: "not_accessible" });
  });

  it("returns a distinct status for a valid but unissued generated code", async () => {
    const harness = createHarness(null);
    await expect(harness.service.resolve(GENERATED, ADMIN)).resolves.toMatchObject({
      status: "unissued_system_code",
      target: null,
    });
  });
});

function createHarness(record: QrResolutionRecord | null) {
  const repository: QrResolutionRepository = {
    findByCanonicalKey: async () => record,
  };
  const repositories: QrResolutionRepositories = { qr: repository };
  const unitOfWork: UnitOfWork<QrResolutionRepositories> = {
    read: (work) => work(repositories),
    transaction: (work) => work(repositories),
  };
  return { service: new QrResolutionService(unitOfWork) };
}

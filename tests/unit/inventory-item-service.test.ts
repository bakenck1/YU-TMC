import { describe, expect, it } from "vitest";

import type {
  AppendItemAuditRecord,
  ArchiveInventoryItemRecord,
  InsertInventoryItemRecord,
  InsertItemQrRecord,
  InventoryItemRecord,
  InventoryItemRepositories,
  InventoryItemRepository,
  ReplaceItemQrRecord,
  UpdateInventoryItemContentRecord,
  UpdateInventoryItemProtectedRecord,
} from "@/lib/application/ports/inventory-item-repositories";
import type { UnitOfWork } from "@/lib/application/ports/unit-of-work";
import { InventoryItemService } from "@/lib/application/services/inventory-item-service";

const NOW = new Date("2026-07-29T08:00:00.000Z");
const ADMIN = { userId: "admin-1", role: "admin" as const };
const TECHNICIAN = { userId: "technician-1", role: "warehouse" as const };
const EMPLOYEE = { userId: "employee-1", role: "employee" as const };

describe("InventoryItemService", () => {
  it("creates a temporary-numbered item with generated QR and audit", async () => {
    const harness = createHarness();
    const item = await harness.service.createItem(
      { name: "  Ноутбук  ", description: "  Dell  ", roomId: harness.roomId },
      TECHNICIAN,
    );
    expect(item).toMatchObject({
      name: "Ноутбук",
      description: "Dell",
      inventoryNumberKind: "temporary",
      inventoryNumber: "TMP-2026-000001",
      qrCode: `YUQ1:${"0".repeat(26)}`,
      room: { designation: "D212", buildingName: "Корпус A" },
      version: 1,
    });
    expect(harness.audits.at(-1)).toMatchObject({
      action: "item.created",
      actorId: TECHNICIAN.userId,
      afterValues: expect.objectContaining({
        inventoryNumberKind: "temporary",
      }),
    });
  });

  it("lets an administrator archive an item while keeping an audit record", async () => {
    const harness = createHarness();
    const item = await harness.service.createItem(
      { name: "Notebook", roomId: harness.roomId },
      ADMIN,
    );

    await harness.service.archiveItem(item.id, item.version, ADMIN);

    expect(harness.audits.at(-1)).toMatchObject({
      action: "item.archived",
      actorRole: "admin",
      afterValues: { status: "decommissioned", name: "Notebook" },
    });
  });

  it("limits employee reads to assigned items and protects edits by role/version", async () => {
    const harness = createHarness();
    const item = await harness.service.createItem(
      { name: "Printer", roomId: harness.roomId, inventoryNumber: "OFF-1" },
      ADMIN,
    );
    await expect(harness.service.listItems(EMPLOYEE)).resolves.toEqual([]);
    await expect(
      harness.service.updateProtected(
        item.id,
        {
          version: 1,
          roomId: harness.roomId,
          inventoryNumber: "OFF-2",
          status: "active",
        },
        TECHNICIAN,
      ),
    ).rejects.toMatchObject({ kind: "forbidden" });
    await expect(
      harness.service.updateContent(
        item.id,
        { version: 2, name: "Changed" },
        ADMIN,
      ),
    ).rejects.toMatchObject({ kind: "conflict", publicCode: "version_conflict" });
    const updated = await harness.service.updateProtected(
      item.id,
      {
        version: 1,
        roomId: harness.roomId,
        inventoryNumber: "OFF-2",
        status: "maintenance",
      },
      ADMIN,
    );
    expect(updated).toMatchObject({
      inventoryNumber: "OFF-2",
      status: "maintenance",
      version: 2,
    });
  });

  it("lets only an administrator replace QR while preserving an audit trail", async () => {
    const harness = createHarness();
    const item = await harness.service.createItem(
      { name: "Projector", roomId: harness.roomId },
      ADMIN,
    );
    const previousQr = item.qrCode;
    const updated = await harness.service.updateProtected(
      item.id,
      {
        version: item.version,
        roomId: harness.roomId,
        inventoryNumber: "OFF-QR-1",
        status: "active",
        replaceQr: true,
        qrReplaceReason: "Damaged label",
      },
      ADMIN,
    );
    expect(updated.qrCode).not.toBe(previousQr);
    expect(harness.revokedQrCodes).toContain(previousQr);
    expect(harness.audits.at(-1)).toMatchObject({
      action: "item.protected_fields_updated",
      afterValues: expect.objectContaining({
        qrReplaceReason: "Damaged label",
      }),
    });
  });

  it("sends an item to service without changing its inventory number", async () => {
    const harness = createHarness();
    const item = await harness.service.createItem(
      { name: "Monitor", roomId: harness.roomId, inventoryNumber: "INV-42" },
      ADMIN,
    );

    const updated = await harness.service.sendToService(
      item.id,
      item.version,
      { serviceName: "Service Centre", reason: "Screen diagnostics" },
      ADMIN,
    );

    expect(updated).toMatchObject({
      status: "maintenance",
      inventoryNumber: "INV-42",
      inventoryNumberKind: "official",
      version: 2,
    });
    expect(harness.audits.at(-1)).toMatchObject({
      action: "item.sent_to_service",
      afterValues: expect.objectContaining({ serviceName: "Service Centre" }),
    });
  });
});

function createHarness() {
  const repository = new MemoryItemRepository();
  let id = 0;
  let qrSeed = 0;
  const repositories: InventoryItemRepositories = { items: repository };
  const unitOfWork: UnitOfWork<InventoryItemRepositories> = {
    read: (work) => work(repositories),
    transaction: (work) => work(repositories),
  };
  return {
    roomId: "00000000-0000-4000-8000-000000000001",
    audits: repository.audits,
    revokedQrCodes: repository.revokedQrCodes,
    service: new InventoryItemService(
      unitOfWork,
      { now: () => NOW },
      {
        create: () =>
          `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
      },
      {
        create: () => {
          const entropy = new Uint8Array(16);
          entropy[15] = qrSeed++;
          return entropy;
        },
      },
      { next: (year) => `TMP-${year}-000001` },
    ),
  };
}

class MemoryItemRepository implements InventoryItemRepository {
  readonly audits: AppendItemAuditRecord[] = [];
  readonly revokedQrCodes: string[] = [];
  private readonly items = new Map<string, InventoryItemRecord>();

  async roomExists(id: string) {
    return id === "00000000-0000-4000-8000-000000000001";
  }

  async listItems() {
    return [...this.items.values()];
  }

  async listItemsAssignedTo(userId: string) {
    return [...this.items.values()].filter((item) => item.responsibleId === userId);
  }

  async findItemById(id: string) {
    return this.items.get(id) ?? null;
  }

  async insertItem(input: InsertInventoryItemRecord) {
    const record: InventoryItemRecord = {
      id: input.id,
      name: input.name,
      description: input.description,
      itemType: input.itemType,
      brand: input.brand,
      model: input.model,
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      roomId: input.roomId,
      roomDesignation: "D212",
      floorNumber: 2,
      buildingId: "00000000-0000-4000-8000-000000000002",
      buildingName: "Корпус A",
      inventoryNumberKind: input.inventoryNumberKind,
      inventoryNumber: input.inventoryNumber,
      status: "active",
      qrCode: null,
      responsibleId: null,
      responsibleName: null,
      photoUrl: null,
      version: 1,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
    };
    this.items.set(record.id, record);
    return record;
  }

  async updateItemContent(input: UpdateInventoryItemContentRecord) {
    const current = this.items.get(input.id);
    if (!current || current.version !== input.expectedVersion) return null;
    const updated = {
      ...current,
      name: input.name,
      description: input.description,
      version: current.version + 1,
      updatedAt: input.occurredAt,
    };
    this.items.set(input.id, updated);
    return updated;
  }

  async updateItemProtected(input: UpdateInventoryItemProtectedRecord) {
    const current = this.items.get(input.id);
    if (!current || current.version !== input.expectedVersion) return null;
    const updated = {
      ...current,
      roomId: input.roomId,
      inventoryNumberKind: input.inventoryNumberKind,
      inventoryNumber: input.inventoryNumber,
      status: input.status,
      version: current.version + 1,
      updatedAt: input.occurredAt,
    };
    this.items.set(input.id, updated);
    return updated;
  }

  async updateItemStatus(input: import("@/lib/application/ports/inventory-item-repositories").UpdateInventoryItemStatusRecord) {
    const current = this.items.get(input.id);
    if (!current || current.version !== input.expectedVersion) return null;
    const updated = {
      ...current,
      status: input.status,
      version: current.version + 1,
      updatedAt: input.occurredAt,
    };
    this.items.set(input.id, updated);
    return updated;
  }

  async archiveItem(input: ArchiveInventoryItemRecord) {
    const current = this.items.get(input.id);
    if (!current || current.version !== input.expectedVersion) return null;
    const archived = {
      ...current,
      status: "decommissioned" as const,
      version: current.version + 1,
      updatedAt: input.occurredAt,
    };
    this.items.set(input.id, archived);
    return archived;
  }

  async insertItemQr(input: InsertItemQrRecord) {
    const current = this.items.get(input.itemId);
    if (current) this.items.set(input.itemId, { ...current, qrCode: input.value });
  }

  async replaceItemQr(input: ReplaceItemQrRecord) {
    const current = this.items.get(input.itemId);
    if (!current?.qrCode) throw new Error("active_qr_not_found");
    this.revokedQrCodes.push(current.qrCode);
    this.items.set(input.itemId, { ...current, qrCode: input.value });
  }

  async appendAudit(input: AppendItemAuditRecord) {
    this.audits.push(input);
  }
}

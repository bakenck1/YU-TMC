import { describe, expect, it } from "vitest";

import type {
  AppendInspectionAuditRecord,
  InspectionRecord,
  InspectionRoomRecord,
  ItemResultRecord,
  ItemSnapshotAtScan,
  InsertItemResultRecord,
  InsertItemResultRevisionRecord,
  InsertInspectionRecord,
  InsertInspectionRoomRecord,
  InventoryInspectionRepositories,
  InventoryInspectionRepository,
  RoomSnapshot,
} from "@/lib/application/ports/inventory-inspection-repositories";
import type { UnitOfWork } from "@/lib/application/ports/unit-of-work";
import { InventoryInspectionService } from "@/lib/application/services/inventory-inspection-service";

const NOW = new Date("2026-07-29T08:00:00.000Z");
const TECHNICIAN = { userId: "tech-1", role: "warehouse" as const };
const OTHER_TECHNICIAN = { userId: "tech-2", role: "warehouse" as const };
const ADMIN = { userId: "admin-1", role: "admin" as const };
const EMPLOYEE = { userId: "employee-1", role: "employee" as const };

describe("InventoryInspectionService", () => {
  it("creates a technician-owned draft and snapshots selected rooms", async () => {
    const harness = createHarness();
    const inspection = await harness.service.create(
      { name: "  Проверка июля  " },
      TECHNICIAN,
    );
    expect(inspection).toMatchObject({
      name: "Проверка июля",
      technicianId: TECHNICIAN.userId,
      status: "draft",
      rooms: [],
    });
    const room = await harness.service.addRoom(
      inspection.id,
      { buildingId: harness.buildingId, roomId: harness.roomId },
      TECHNICIAN,
    );
    expect(room).toMatchObject({
      buildingName: "Корпус A",
      roomDesignation: "D212",
      floorNumber: 2,
    });
  });

  it("does not allow employees to create or mutate a technician inspection", async () => {
    const harness = createHarness();
    await expect(
      harness.service.create({ name: "Nope" }, EMPLOYEE),
    ).rejects.toMatchObject({ kind: "forbidden" });
  });

  it("does not disclose one technician's inspections to another technician", async () => {
    const harness = createHarness();
    const ownInspection = await harness.service.create({ name: "Own" }, TECHNICIAN);
    const otherInspection = await harness.service.create(
      { name: "Other" },
      OTHER_TECHNICIAN,
    );

    await expect(harness.service.list(TECHNICIAN)).resolves.toEqual([
      expect.objectContaining({ id: ownInspection.id, technicianId: TECHNICIAN.userId }),
    ]);
    await expect(harness.service.list(ADMIN)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: ownInspection.id }),
        expect.objectContaining({ id: otherInspection.id }),
      ]),
    );
  });

  it("snapshots an item result once per inspection and returns the prior result", async () => {
    const harness = createHarness();
    const inspection = await harness.service.create({ name: "July" }, TECHNICIAN);
    const room = await harness.service.addRoom(
      inspection.id,
      { buildingId: harness.buildingId, roomId: harness.roomId },
      TECHNICIAN,
    );
    const recorded = await harness.service.recordItemResult(
      inspection.id,
      room.id,
      { itemId: harness.itemId, result: "present", comment: "Found" },
      TECHNICIAN,
    );
    expect(recorded).toMatchObject({
      result: "present",
      comment: "Found",
      registryRoomIdAtScan: harness.roomId,
      responsibleIdAtScan: "employee-1",
    });
    await expect(
      harness.service.recordItemResult(
        inspection.id,
        room.id,
        { itemId: harness.itemId, result: "missing" },
        TECHNICIAN,
      ),
    ).resolves.toMatchObject({ id: recorded.id, result: "present" });
  });

  it("does not record an item from another room against the selected inspection room", async () => {
    const harness = createHarness();
    const inspection = await harness.service.create({ name: "July" }, TECHNICIAN);
    const room = await harness.service.addRoom(
      inspection.id,
      { buildingId: harness.buildingId, roomId: harness.roomId },
      TECHNICIAN,
    );
    harness.repository.setItemRegistryRoom(
      "00000000-0000-4000-8000-000000000099",
    );

    await expect(
      harness.service.recordItemResult(
        inspection.id,
        room.id,
        { itemId: harness.itemId, result: "present" },
        TECHNICIAN,
      ),
    ).rejects.toMatchObject({
      kind: "not_found",
      publicCode: "item_not_found",
    });
  });
});

function createHarness() {
  const repository = new MemoryInspectionRepository();
  let id = 0;
  const repositories: InventoryInspectionRepositories = {
    inspections: repository,
  };
  const unitOfWork: UnitOfWork<InventoryInspectionRepositories> = {
    read: (work) => work(repositories),
    transaction: (work) => work(repositories),
  };
  return {
    buildingId: "00000000-0000-4000-8000-000000000002",
    roomId: "00000000-0000-4000-8000-000000000003",
    itemId: "00000000-0000-4000-8000-000000000004",
    repository,
    service: new InventoryInspectionService(
      unitOfWork,
      { now: () => NOW },
      {
        create: () =>
          `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
      },
    ),
  };
}

class MemoryInspectionRepository implements InventoryInspectionRepository {
  private readonly inspections = new Map<string, InspectionRecord>();
  private readonly rooms = new Map<string, InspectionRoomRecord>();
  private readonly itemResults = new Map<string, ItemResultRecord>();
  private readonly snapshot: RoomSnapshot = {
    buildingId: "00000000-0000-4000-8000-000000000002",
    roomId: "00000000-0000-4000-8000-000000000003",
    buildingName: "Корпус A",
    buildingAddress: "Address",
    roomDesignation: "D212",
    floorNumber: 2,
    floorLabel: null,
  };
  private itemSnapshot: ItemSnapshotAtScan = {
    itemId: "00000000-0000-4000-8000-000000000004",
    registryRoomId: "00000000-0000-4000-8000-000000000003",
    responsibleUserId: "employee-1",
    itemName: "Projector",
    inventoryNumberKind: "official",
    inventoryNumber: "INV-1",
    buildingName: "Building A",
    roomDesignation: "D212",
  };

  async listInspections(technicianId?: string) {
    return [...this.inspections.values()].filter(
      (value) => !technicianId || value.technicianId === technicianId,
    );
  }

  async findInspection(id: string) {
    return this.inspections.get(id) ?? null;
  }

  async listRooms(inspectionId: string) {
    return [...this.rooms.values()].filter((room) => room.inspectionId === inspectionId);
  }

  async findInspectionRoom(inspectionId: string, inspectionRoomId: string) {
    const room = this.rooms.get(inspectionRoomId);
    return room?.inspectionId === inspectionId ? room : null;
  }

  async findItemSnapshot(itemId: string) {
    return itemId === this.itemSnapshot.itemId ? this.itemSnapshot : null;
  }

  setItemRegistryRoom(registryRoomId: string) {
    this.itemSnapshot = { ...this.itemSnapshot, registryRoomId };
  }

  async findItemResult(inspectionId: string, itemId: string) {
    return (
      [...this.itemResults.values()].find(
        (result) => result.inspectionId === inspectionId && result.itemId === itemId,
      ) ?? null
    );
  }

  async listItemResults(inspectionId: string) {
    return [...this.itemResults.values()].filter(
      (result) => result.inspectionId === inspectionId,
    );
  }

  async findActiveRoomSnapshot(buildingId: string, roomId: string) {
    return buildingId === this.snapshot.buildingId && roomId === this.snapshot.roomId
      ? this.snapshot
      : null;
  }

  async insertInspection(input: InsertInspectionRecord) {
    const value: InspectionRecord = {
      id: input.id,
      name: input.name,
      technicianId: input.technicianId,
      status: "draft",
      version: 1,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    this.inspections.set(value.id, value);
    return value;
  }

  async insertInspectionRoom(input: InsertInspectionRoomRecord) {
    const value: InspectionRoomRecord = {
      id: input.id,
      inspectionId: input.inspectionId,
      ...input.snapshot,
      addedAt: input.addedAt,
      inspectedAt: null,
    };
    this.rooms.set(value.id, value);
    return value;
  }

  async insertItemResult(input: InsertItemResultRecord) {
    const result: ItemResultRecord = {
      id: input.id,
      inspectionId: input.inspectionId,
      inspectionRoomId: input.inspectionRoomId,
      itemId: input.snapshot.itemId,
      registryRoomIdAtScan: input.snapshot.registryRoomId,
      responsibleIdAtScan: input.snapshot.responsibleUserId,
      itemNameSnapshot: input.snapshot.itemName,
      inventoryNumberSnapshot: input.snapshot.inventoryNumber,
      result: "undetermined",
      comment: null,
      revisionNumber: 0,
      createdAt: input.createdAt,
    };
    this.itemResults.set(result.id, result);
    return result;
  }

  async insertItemResultRevision(input: InsertItemResultRevisionRecord) {
    const result = this.itemResults.get(input.resultId);
    if (!result) throw new Error("result_not_found");
    this.itemResults.set(input.resultId, {
      ...result,
      result: input.result,
      comment: input.comment,
      revisionNumber: result.revisionNumber + 1,
    });
  }

  async markInspectionRoomInspected() {
    return undefined;
  }

  async appendAudit(input: AppendInspectionAuditRecord) {
    void input;
    return undefined;
  }
}

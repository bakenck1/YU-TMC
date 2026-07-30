import { describe, expect, it } from "vitest";

import type {
  AppendLocationAuditRecord,
  ArchiveBuildingRecord,
  ArchiveRoomRecord,
  BuildingRecord,
  InsertBuildingQrRecord,
  InsertBuildingRecord,
  InsertRoomQrRecord,
  InsertRoomRecord,
  InventoryLocationRepositories,
  InventoryLocationRepository,
  RoomRecord,
  UpdateBuildingRecord,
  UpdateRoomRecord,
} from "@/lib/application/ports/inventory-location-repositories";
import type { UnitOfWork } from "@/lib/application/ports/unit-of-work";
import { InventoryLocationService } from "@/lib/application/services/inventory-location-service";
import { ApplicationError } from "@/lib/domain/application-error";

const NOW = new Date("2026-07-29T08:00:00.000Z");
const ADMIN = { userId: "admin-1", role: "admin" as const };
const TECHNICIAN = { userId: "technician-1", role: "warehouse" as const };
const OWNER = { userId: "owner-1", role: "owner" as const };

describe("InventoryLocationService", () => {
  it("lets a technician create a normalized building with QR and audit", async () => {
    const harness = createHarness();
    const building = await harness.service.createBuilding(
      { name: "  Корпус А  ", address: "  12 мкр, 7  " },
      TECHNICIAN,
    );

    expect(building).toMatchObject({
      name: "Корпус А",
      address: "12 мкр, 7",
      qrCode: `YUQ1:${"0".repeat(26)}`,
      roomCount: 0,
      version: 1,
    });
    expect(harness.repository.audits).toEqual([
      expect.objectContaining({
        actorId: TECHNICIAN.userId,
        actorRole: "warehouse",
        subjectKind: "building",
        action: "building.created",
        afterValues: expect.objectContaining({
          name: "Корпус А",
          address: "12 мкр, 7",
        }),
      }),
    ]);
  });

  it("lets only an administrator update protected building fields", async () => {
    const harness = createHarness();
    const created = await harness.service.createBuilding(
      { name: "A", address: "Address A" },
      TECHNICIAN,
    );

    await expect(
      harness.service.updateBuilding(
        created.id,
        { name: "B", address: "Address B", version: 1 },
        TECHNICIAN,
      ),
    ).rejects.toMatchObject({ kind: "forbidden", publicCode: "forbidden" });

    const updated = await harness.service.updateBuilding(
      created.id,
      { name: "B", address: "Address B", version: 1 },
      ADMIN,
    );
    expect(updated).toMatchObject({
      name: "B",
      address: "Address B",
      qrCode: created.qrCode,
      version: 2,
    });
    expect(harness.repository.audits.at(-1)).toMatchObject({
      action: "building.updated",
      actorRole: "admin",
      beforeValues: { address: "Address A", name: "A" },
      afterValues: { address: "Address B", name: "B" },
      subjectRevision: 2,
    });
  });

  it("fails closed for owner and reports optimistic concurrency conflicts", async () => {
    const harness = createHarness();
    await expect(harness.service.listBuildings(OWNER)).rejects.toBeInstanceOf(
      ApplicationError,
    );
    const created = await harness.service.createBuilding(
      { name: "A", address: "Address A" },
      ADMIN,
    );
    await expect(
      harness.service.updateBuilding(
        created.id,
        { name: "B", address: "Address B", version: 2 },
        ADMIN,
      ),
    ).rejects.toMatchObject({
      kind: "conflict",
      publicCode: "version_conflict",
    });
  });

  it("creates rooms inside a building and keeps their QR on update", async () => {
    const harness = createHarness();
    const building = await harness.service.createBuilding(
      { name: "A", address: "Address A" },
      TECHNICIAN,
    );
    const room = await harness.service.createRoom(
      building.id,
      { designation: "D212", floorNumber: 2 },
      TECHNICIAN,
    );
    expect(room).toMatchObject({
      buildingId: building.id,
      designation: "D212",
      floorNumber: 2,
      qrCode: `YUQ1:${"0".repeat(26)}`,
      version: 1,
    });
    const updated = await harness.service.updateRoom(
      room.id,
      { designation: "D213", floorNumber: 2, floorLabel: "2", version: 1 },
      ADMIN,
    );
    expect(updated).toMatchObject({
      designation: "D213",
      floorLabel: "2",
      qrCode: room.qrCode,
      version: 2,
    });
  });

  it("rejects room updates and archival by a warehouse user even with a known room id", async () => {
    const harness = createHarness();
    const building = await harness.service.createBuilding(
      { name: "A", address: "Address A" },
      ADMIN,
    );
    const room = await harness.service.createRoom(
      building.id,
      { designation: "101", floorNumber: 1 },
      ADMIN,
    );

    await expect(
      harness.service.updateRoom(
        room.id,
        { designation: "Hacked", floorNumber: 1, version: room.version },
        TECHNICIAN,
      ),
    ).rejects.toMatchObject({ kind: "forbidden", publicCode: "forbidden" });
    await expect(
      harness.service.archiveRoom(room.id, room.version, TECHNICIAN),
    ).rejects.toMatchObject({ kind: "forbidden", publicCode: "forbidden" });

    await expect(
      harness.service.updateRoom(
        room.id,
        { designation: "101", floorNumber: 1, version: room.version },
        ADMIN,
      ),
    ).resolves.toMatchObject({ designation: "101", status: "active" });
  });

  it("archives an empty room and then its empty building with audit history", async () => {
    const harness = createHarness();
    const building = await harness.service.createBuilding(
      { name: "A", address: "Address A" },
      ADMIN,
    );
    const room = await harness.service.createRoom(
      building.id,
      { designation: "101", floorNumber: 1 },
      ADMIN,
    );

    await harness.service.archiveRoom(room.id, room.version, ADMIN);
    await harness.service.archiveBuilding(building.id, building.version, ADMIN);

    expect(harness.repository.audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "room.archived" }),
        expect.objectContaining({ action: "building.archived" }),
      ]),
    );
  });

  it("does not expose or create rooms through an archived building", async () => {
    const harness = createHarness();
    const building = await harness.service.createBuilding(
      { name: "Archived", address: "Address A" },
      ADMIN,
    );
    await harness.service.archiveBuilding(building.id, building.version, ADMIN);

    await expect(
      harness.service.listRooms(building.id, TECHNICIAN),
    ).rejects.toMatchObject({
      kind: "not_found",
      publicCode: "building_not_found",
    });
    await expect(
      harness.service.createRoom(
        building.id,
        { designation: "101", floorNumber: 1 },
        TECHNICIAN,
      ),
    ).rejects.toMatchObject({
      kind: "not_found",
      publicCode: "building_not_found",
    });
  });

  it.each([
    [{ name: "", address: "Address" }, "invalid_building_name"],
    [{ name: "A", address: " " }, "invalid_building_address"],
    [{ name: "x".repeat(121), address: "Address" }, "invalid_building_name"],
  ])("validates building input %j", async (input, publicCode) => {
    const harness = createHarness();
    await expect(
      harness.service.createBuilding(input, ADMIN),
    ).rejects.toMatchObject({ kind: "validation", publicCode });
  });
});

function createHarness() {
  const repository = new MemoryLocationRepository();
  let id = 0;
  const repositories = { locations: repository };
  const unitOfWork: UnitOfWork<InventoryLocationRepositories> = {
    read: (work) => work(repositories),
    transaction: (work) => work(repositories),
  };
  return {
    repository,
    service: new InventoryLocationService(
      unitOfWork,
      { now: () => NOW },
      { create: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}` },
      { create: () => new Uint8Array(16) },
    ),
  };
}

class MemoryLocationRepository implements InventoryLocationRepository {
  readonly audits: AppendLocationAuditRecord[] = [];
  private readonly buildings = new Map<string, BuildingRecord>();
  private readonly rooms = new Map<string, RoomRecord>();

  async listBuildings() {
    return [...this.buildings.values()];
  }

  async findBuildingById(id: string) {
    return this.buildings.get(id) ?? null;
  }

  async insertBuilding(input: InsertBuildingRecord) {
    const record: BuildingRecord = {
      id: input.id,
      name: input.name,
      nameKey: input.nameKey,
      address: input.address,
      addressKey: input.addressKey,
      qrCode: "",
      roomCount: 0,
      status: "active",
      version: 1,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
    };
    this.buildings.set(record.id, record);
    return record;
  }

  async updateBuilding(input: UpdateBuildingRecord) {
    const current = this.buildings.get(input.id);
    if (!current || current.version !== input.expectedVersion) return null;
    const updated: BuildingRecord = {
      ...current,
      name: input.name,
      nameKey: input.nameKey,
      address: input.address,
      addressKey: input.addressKey,
      version: current.version + 1,
      updatedAt: input.occurredAt,
    };
    this.buildings.set(input.id, updated);
    return updated;
  }

  async archiveBuilding(input: ArchiveBuildingRecord) {
    const current = this.buildings.get(input.id);
    if (!current || current.version !== input.expectedVersion) return null;
    const archived = {
      ...current,
      status: "archived" as const,
      version: current.version + 1,
      updatedAt: input.occurredAt,
    };
    this.buildings.set(input.id, archived);
    return archived;
  }

  async countActiveRooms(buildingId: string) {
    return [...this.rooms.values()].filter(
      (room) => room.buildingId === buildingId && room.status === "active",
    ).length;
  }

  async insertBuildingQr(input: InsertBuildingQrRecord) {
    const current = this.buildings.get(input.buildingId);
    if (!current) throw new Error("Missing building.");
    this.buildings.set(input.buildingId, {
      ...current,
      qrCode: input.value,
    });
  }

  async appendAudit(input: AppendLocationAuditRecord) {
    this.audits.push(input);
  }

  async listRooms(buildingId: string) {
    return [...this.rooms.values()].filter(
      (room) => room.buildingId === buildingId,
    );
  }

  async findRoomById(id: string) {
    return this.rooms.get(id) ?? null;
  }

  async insertRoom(input: InsertRoomRecord) {
    const record: RoomRecord = {
      id: input.id,
      buildingId: input.buildingId,
      designation: input.designation,
      designationKey: input.designationKey,
      floorNumber: input.floorNumber,
      floorLabel: input.floorLabel,
      qrCode: "",
      status: "active",
      version: 1,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
    };
    this.rooms.set(record.id, record);
    return record;
  }

  async updateRoom(input: UpdateRoomRecord) {
    const current = this.rooms.get(input.id);
    if (!current || current.version !== input.expectedVersion) return null;
    const updated: RoomRecord = {
      ...current,
      designation: input.designation,
      designationKey: input.designationKey,
      floorNumber: input.floorNumber,
      floorLabel: input.floorLabel,
      version: current.version + 1,
      updatedAt: input.occurredAt,
    };
    this.rooms.set(input.id, updated);
    return updated;
  }

  async archiveRoom(input: ArchiveRoomRecord) {
    const current = this.rooms.get(input.id);
    if (!current || current.version !== input.expectedVersion) return null;
    const archived = {
      ...current,
      status: "archived" as const,
      version: current.version + 1,
      updatedAt: input.occurredAt,
    };
    this.rooms.set(input.id, archived);
    return archived;
  }

  async countActiveItems() {
    return 0;
  }

  async insertRoomQr(input: InsertRoomQrRecord) {
    const current = this.rooms.get(input.roomId);
    if (!current) throw new Error("Missing room.");
    this.rooms.set(input.roomId, { ...current, qrCode: input.value });
  }
}

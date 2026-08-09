import assert from "node:assert/strict";
import test from "node:test";

import type {
  QrResolutionRecord,
  QrResolutionRepositories,
} from "../lib/application/ports/qr-resolution-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { QrResolutionService } from "../lib/application/services/qr-resolution-service";
import { ApplicationError } from "../lib/domain/application-error";

const QR_RECORD: QrResolutionRecord = {
  canonicalKey: "INV-42",
  format: "legacy_raw",
  qrStatus: "active",
  targetKind: "room",
  targetId: "4ee0bbec-4bc9-4cb7-a4e2-78fd2dbc639d",
  targetStatus: "active",
  title: "Room 42",
  buildingName: "Main",
  roomDesignation: "42",
  inventoryNumber: null,
  responsibleName: null,
};

const BARCODE_RECORD: QrResolutionRecord = {
  canonicalKey: "INV-42",
  format: "legacy_raw",
  qrStatus: "active",
  targetKind: "item",
  targetId: "0d8c3600-5d2f-4e9c-b26f-1bc773146aec",
  targetStatus: "active",
  title: "Projector",
  buildingName: "Main",
  roomDesignation: "42",
  inventoryNumber: "INV-42",
  responsibleName: null,
};

test("barcode mode resolves its namespace before colliding QR aliases", async () => {
  const calls: string[] = [];
  const service = createService({
    async findByCanonicalKey() {
      calls.push("qr");
      return QR_RECORD;
    },
    async findItemByBarcode(value, inventoryNumberKey, fallbackKey) {
      calls.push("barcode");
      assert.equal(value, "YUB-INV-42");
      assert.equal(inventoryNumberKey, "inv-42");
      assert.equal(fallbackKey, null);
      return BARCODE_RECORD;
    },
  });

  const result = await service.resolve(
    "YUB-INV-42",
    { userId: "admin", role: "admin" },
    "barcode",
  );

  assert.equal(result.target?.kind, "item");
  assert.deepEqual(calls, ["barcode"]);
});

test("QR mode never falls through to the inventory-number namespace", async () => {
  const calls: string[] = [];
  const service = createService({
    async findByCanonicalKey() {
      calls.push("qr");
      return null;
    },
    async findItemByBarcode() {
      calls.push("barcode");
      return BARCODE_RECORD;
    },
  });

  const result = await service.resolve(
    "INV-42",
    { userId: "admin", role: "admin" },
    "qr",
  );

  assert.equal(result.status, "unknown");
  assert.equal(result.target, null);
  assert.deepEqual(calls, ["qr"]);
});

test("auto mode preserves legacy QR priority for callers without a kind", async () => {
  const service = createService({
    async findByCanonicalKey() {
      return QR_RECORD;
    },
    async findItemByBarcode() {
      return BARCODE_RECORD;
    },
  });

  const result = await service.resolve("INV-42", {
    userId: "admin",
    role: "admin",
  });

  assert.equal(result.target?.kind, "room");
});

test("auto mode resolves a printed YUB barcode after a QR miss", async () => {
  const service = createService({
    async findByCanonicalKey() {
      return null;
    },
    async findItemByBarcode(value, inventoryNumberKey, fallbackKey) {
      assert.equal(value, "YUB-INV-42");
      assert.equal(inventoryNumberKey, "inv-42");
      assert.equal(fallbackKey, null);
      return BARCODE_RECORD;
    },
  });

  const result = await service.resolve("YUB-INV-42", {
    userId: "admin",
    role: "admin",
  });

  assert.equal(result.target?.kind, "item");
});

test("auto mode resolves a printed YUI fallback after a QR miss", async () => {
  const service = createService({
    async findByCanonicalKey() {
      return null;
    },
    async findItemByBarcode(value, inventoryNumberKey, fallbackKey) {
      assert.equal(value, "YUI-0D8C36005D2F4E9C");
      assert.equal(inventoryNumberKey, "");
      assert.equal(fallbackKey, "0D8C36005D2F4E9C");
      return BARCODE_RECORD;
    },
  });

  const result = await service.resolve("YUI-0D8C36005D2F4E9C", {
    userId: "admin",
    role: "admin",
  });

  assert.equal(result.target?.kind, "item");
});

test("item-only QR permission never discloses non-item or inactive targets", async () => {
  let record = QR_RECORD;
  const service = createService({
    async findByCanonicalKey() {
      return record;
    },
    async findItemByBarcode() {
      return null;
    },
  });
  const employee = { userId: "employee", role: "employee" } as const;

  for (const restricted of [
    QR_RECORD,
    { ...QR_RECORD, targetKind: "building" as const },
    { ...BARCODE_RECORD, qrStatus: "revoked" as const },
    { ...BARCODE_RECORD, targetStatus: "maintenance" as const },
  ]) {
    record = restricted;
    await assert.rejects(
      () => service.resolve("INV-42", employee, "qr"),
      (error: unknown) =>
        error instanceof ApplicationError &&
        error.kind === "not_found" &&
        error.publicCode === "not_accessible",
    );
  }

  record = BARCODE_RECORD;
  assert.equal(
    (await service.resolve("INV-42", employee, "qr")).target?.kind,
    "item",
  );
  record = QR_RECORD;
  for (const role of ["admin", "warehouse"] as const) {
    assert.equal(
      (await service.resolve("INV-42", { userId: role, role }, "qr")).target
        ?.kind,
      "room",
    );
    await assert.rejects(
      () =>
        service.resolve(
          "INV-42",
          { userId: role, role },
          "qr",
          "item",
        ),
      (error: unknown) =>
        error instanceof ApplicationError && error.publicCode === "not_accessible",
    );
  }
});

test("an explicit room scope preserves the authenticated room scanner", async () => {
  const service = createService({
    async findByCanonicalKey() {
      return QR_RECORD;
    },
    async findItemByBarcode() {
      return null;
    },
  });

  const result = await service.resolve(
    "INV-42",
    { userId: "employee", role: "employee" },
    "qr",
    "room",
  );
  assert.equal(result.target?.kind, "room");
  await assert.rejects(
    () =>
      service.resolve(
        "INV-42",
        { userId: "employee", role: "employee" },
        "qr",
        "item",
      ),
    (error: unknown) =>
      error instanceof ApplicationError && error.publicCode === "not_accessible",
  );
});

function createService(
  qr: QrResolutionRepositories["qr"],
): QrResolutionService {
  const unitOfWork: UnitOfWork<QrResolutionRepositories> = {
    async read<Result>(
      work: (repositories: QrResolutionRepositories) => Promise<Result>,
    ): Promise<Result> {
      return work({ qr });
    },
    async transaction<Result>(
      work: (repositories: QrResolutionRepositories) => Promise<Result>,
    ): Promise<Result> {
      return work({ qr });
    },
  };
  return new QrResolutionService(unitOfWork);
}

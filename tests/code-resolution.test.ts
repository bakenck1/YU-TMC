import assert from "node:assert/strict";
import test from "node:test";

import type {
  QrResolutionRecord,
  QrResolutionRepositories,
} from "../lib/application/ports/qr-resolution-repositories";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { QrResolutionService } from "../lib/application/services/qr-resolution-service";

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
    const result = await service.resolve("INV-42", employee, "qr");
    assert.equal(result.status, "unknown");
    assert.equal(result.target, null);
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
    assert.equal(
      (
        await service.resolve(
          "INV-42",
          { userId: role, role },
          "qr",
          "item",
        )
      ).target,
      null,
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
  assert.equal(
    (
      await service.resolve(
        "INV-42",
        { userId: "employee", role: "employee" },
        "qr",
        "item",
      )
    ).target,
    null,
  );
});

test("employee lookups cannot distinguish inaccessible records from absent codes", async () => {
  let record: QrResolutionRecord | null = null;
  const service = createService({
    async findByCanonicalKey() {
      return record;
    },
    async findItemByBarcode() {
      return record;
    },
  });
  const employee = { userId: "employee", role: "employee" } as const;

  const absentBarcode = await service.resolve(
    "INV-42",
    employee,
    "barcode",
    "item",
  );
  record = { ...BARCODE_RECORD, targetStatus: "maintenance" };
  const inaccessibleBarcode = await service.resolve(
    "INV-42",
    employee,
    "barcode",
    "item",
  );
  assert.deepEqual(inaccessibleBarcode, absentBarcode);

  record = null;
  const absentQr = await service.resolve(
    "INV-42",
    employee,
    "qr",
    "item",
  );
  record = QR_RECORD;
  const wrongTargetQr = await service.resolve(
    "INV-42",
    employee,
    "qr",
    "item",
  );
  assert.deepEqual(wrongTargetQr, absentQr);
});

test("employee resolution exposes assignment state without a foreign owner's name", async () => {
  const foreignItem: QrResolutionRecord = {
    ...BARCODE_RECORD,
    responsibleName: "Foreign Owner",
    responsibleUserId: "foreign-employee",
  };
  const service = createService({
    async findByCanonicalKey() {
      return foreignItem;
    },
    async findItemByBarcode() {
      return foreignItem;
    },
  });

  const employeeResult = await service.resolve(
    "INV-42",
    { userId: "employee", role: "employee" },
    "barcode",
    "item",
  );
  assert.equal(employeeResult.target?.responsibleName, undefined);
  assert.equal(employeeResult.target?.isAssigned, true);
  assert.equal(employeeResult.target?.isCurrentUserResponsible, false);

  const warehouseResult = await service.resolve(
    "INV-42",
    { userId: "warehouse", role: "warehouse" },
    "barcode",
    "item",
  );
  assert.equal(warehouseResult.target?.responsibleName, "Foreign Owner");
  assert.equal(warehouseResult.target?.isAssigned, true);
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

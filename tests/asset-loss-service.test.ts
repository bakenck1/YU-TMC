import assert from "node:assert/strict";
import test from "node:test";

import type { AssetLossRecord,AssetLossRepositories,AssetLossRepository } from "../lib/application/ports/asset-loss-repository";
import type { UnitOfWork } from "../lib/application/ports/unit-of-work";
import { AssetLossService } from "../lib/application/services/asset-loss-service";
import { ApplicationError } from "../lib/domain/application-error";

const EMPLOYEE_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CASE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PHOTO_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PERIOD_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const NOW = new Date("2026-09-08T10:00:00.000Z");

test("revoked actor and employee acting on behalf fail closed", async () => {
  const revoked = fixture({ actorActive: false });
  await assert.rejects(revoked.service.create({ itemId: ITEM_ID }, employee()), applicationCode("forbidden"));
  const active = fixture();
  await assert.rejects(active.service.create({ itemId: ITEM_ID, employeeId: ADMIN_ID }, employee()), applicationCode("forbidden"));
});

test("administrator creates on behalf and list uses an opaque sentinel cursor", async () => {
  const { service, repository, calls } = fixture({ role: "admin", actorId: ADMIN_ID });
  repository.findCase = async () => record({ employeeId: EMPLOYEE_ID });
  await service.create({ itemId: ITEM_ID, employeeId: EMPLOYEE_ID, amount: "10" }, admin());
  assert.equal((calls.insertCase[0] as { employeeId: string }).employeeId, EMPLOYEE_ID);
  const listInputs: unknown[] = [];
  repository.list = async (input) => {
    listInputs.push(input);
    return Array.from({ length: 101 }, (_, index) => record({ id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}` }));
  };
  const page = await service.list(admin());
  assert.equal(page.lossCases.length, 100); assert.ok(page.nextCursor);
  repository.list = async (input) => { listInputs.push(input); return []; };
  await service.list(admin(), page.nextCursor!);
  assert.equal((listInputs[0] as { employeeId: string | null }).employeeId, null);
  assert.deepEqual((listInputs[1] as { before: { id: string } }).before.id, page.lossCases.at(-1)!.id);
});

test("a known foreign case is hidden from an employee submitting a receipt", async () => {
  const { service, repository, calls } = fixture();
  repository.findCaseForUpdate = async () => record({ employeeId: ADMIN_ID });
  await assert.rejects(service.submitReceipt(CASE_ID, photo(), employee()), applicationCode("loss_case_not_found"));
  assert.equal(calls.receipts.length, 0);
});

test("approval conflicts when responsibility changed and never closes a different period", async () => {
  const { service, repository, calls } = fixture({ role: "admin", actorId: ADMIN_ID });
  repository.findReviewSnapshotForUpdate = async () => ({ ...record({ status: "accounting_review", receiptPhotoId: PHOTO_ID }), employeeActive: true, activeResponsibilityPeriodId: PERIOD_ID, responsibleUserId: ADMIN_ID });
  await assert.rejects(service.review(CASE_ID, { decision: "approved" }, admin()), applicationCode("loss_responsibility_changed"));
  assert.equal(calls.closed.length, 0);
  assert.equal(calls.reviewed.length, 0);
});

test("rejection requires a comment and malformed IDs/cursors are rejected", async () => {
  const { service } = fixture({ role: "admin", actorId: ADMIN_ID });
  await assert.rejects(service.review(CASE_ID, { decision: "rejected", comment: " " }, admin()), applicationCode("loss_review_comment_required"));
  await assert.rejects(service.getReceipt("not-a-uuid", admin()), applicationCode("invalid_loss_case_id"));
  await assert.rejects(service.list(admin(), "not-a-cursor"), applicationCode("invalid_loss_cursor"));
  await assert.rejects(service.create({ itemId: ITEM_ID, amount: "1e3" }, admin()), applicationCode("invalid_loss_amount"));
  await assert.rejects(service.review(CASE_ID, { decision: "rejected", comment: "x".repeat(1001) }, admin()), applicationCode("loss_comment_too_long"));
});

function fixture(options: { role?: "admin" | "employee"; actorId?: string; actorActive?: boolean } = {}) {
  const calls = { insertCase: [] as unknown[], receipts: [] as unknown[], superseded: [] as string[], reviewed: [] as unknown[], closed: [] as unknown[], events: [] as Array<{ fromStatus: string | null; toStatus: string }> };
  const repository: AssetLossRepository = {
    findActor: async (id) => ({ id, role: options.role ?? "employee", active: options.actorActive ?? true, version: 1 }),
    list: async () => [],
    findAssignableItemForUpdate: async () => ({ amount: "1.00", responsibilityPeriodId: PERIOD_ID }),
    insertCase: async (input) => { calls.insertCase.push(input); },
    findCase: async () => record(),
    findCaseForUpdate: async () => record(),
    insertReceipt: async (input) => { calls.receipts.push(input); },
    supersedeReceipt: async (id) => { calls.superseded.push(id); return true; },
    submitReceipt: async () => true,
    getReceipt: async () => ({ bytes: new Uint8Array([1]), mediaType: "image/jpeg" }),
    findReviewSnapshotForUpdate: async () => null,
    reviewCase: async (input) => { calls.reviewed.push(input); return true; },
    closeResponsibility: async (input) => { calls.closed.push(input); return true; },
    appendEvent: async (input) => { calls.events.push(input); },
  };
  const unitOfWork: UnitOfWork<AssetLossRepositories> = {
    read: (work) => work({ assetLosses: repository }),
    transaction: (work) => work({ assetLosses: repository }),
  };
  let idIndex = 0;
  const ids = [CASE_ID, PHOTO_ID, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"];
  return { service: new AssetLossService(unitOfWork, { now: () => NOW, id: () => ids[idIndex++]!, checksum: () => "a".repeat(64) }), repository, calls };
}

function record(overrides: Partial<AssetLossRecord> = {}): AssetLossRecord {
  return { id: CASE_ID, employeeId: EMPLOYEE_ID, itemId: ITEM_ID, responsibilityPeriodId: PERIOD_ID, itemName: "Laptop", inventoryNumber: "INV-1", status: "payment_pending", amount: "1.00", currency: "KZT", receiptPhotoId: null, createdAt: NOW, submittedAt: null, reviewedAt: null, reviewResult: null, reviewComment: null, closedAt: null, ...overrides };
}

function employee() { return { userId: EMPLOYEE_ID, role: "employee" as const, sessionVersion: 1 }; }
function admin() { return { userId: ADMIN_ID, role: "admin" as const, sessionVersion: 1 }; }
function photo() { return { bytes: new Uint8Array([1]), width: 1, height: 1, mediaType: "image/jpeg" as const }; }
function applicationCode(code: string) { return (error: unknown) => error instanceof ApplicationError && error.publicCode === code; }

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { test } from "node:test";
import { passportActions, transitionPassport, type PassportState } from "@/lib/domain/room-passport";
import { APP_PERMISSIONS, hasPermission } from "@/lib/security/permissions";
import { USER_ROLES } from "@/lib/contracts/users";
import { canAccessPath } from "@/lib/security/authorization";
import { validatePassportPdf } from "@/lib/server/pdf/validate-passport";
import { passportPdf } from "./support/passport-pdf";
import { MAX_PASSPORT_BYTES } from "@/lib/contracts/room-passports";

const author = { userId: "11111111-1111-4111-8111-111111111111", role: "passport_author" as const };
const reviewer = { userId: "22222222-2222-4222-8222-222222222222", role: "passport_reviewer" as const };
const empty: PassportState = { status: "not_started", version: 0, fileId: null, uploadedBy: null, submittedBy: null, rejectionReason: null, rejectionComment: null };
const draft: PassportState = { ...empty, status: "in_progress", version: 2, fileId: "file", uploadedBy: author.userId };

test("passport roles inherit exactly employee permissions outside passport management", () => {
  for (const role of ["passport_author", "passport_reviewer"] as const) {
    for (const permission of APP_PERMISSIONS.filter(value => !value.startsWith("inventory.passport."))) assert.equal(hasPermission(role, permission), hasPermission("employee", permission), `${role}: ${permission}`);
    assert.equal(canAccessPath(role, "/"), false);
    assert.equal(canAccessPath(role, "/inventory/inspections"), false);
    assert.equal(canAccessPath(role, "/room-passports"), true);
  }
  for (const role of ["employee", "warehouse", "typography"] as const) assert.equal(canAccessPath(role, "/room-passports"), false);
});

test("explicit start and submit, shared work, review and author-only withdrawal", () => {
  const started = transitionPassport(empty, { action: "start", version: 0 }, author);
  assert.equal(started.status, "in_progress");
  assert.deepEqual(passportActions(started, author), ["upload"]);
  const submitted = transitionPassport(draft, { action: "submit", version: 2 }, reviewer);
  assert.equal(submitted.submittedBy, reviewer.userId);
  assert.throws(() => transitionPassport(submitted, { action: "approve", version: 3 }, author), { publicCode: "passport_action_unavailable" });
  const approved = transitionPassport(submitted, { action: "approve", version: 3 }, reviewer);
  assert.equal(approved.status, "approved");
  assert.deepEqual(passportActions(approved, { ...author, userId: "someone_else" }), []);
  assert.equal(transitionPassport(approved, { action: "return", version: 4, reason: "incorrect" }, author).status, "in_progress");
  assert.deepEqual(transitionPassport(approved, { action: "delete", version: 4 }, reviewer), { ...empty, version: 5 });
});

test("return requires an explicit valid reason, keeps the file and preserves feedback until approval", () => {
  for (const status of ["in_review", "approved"] as const) {
    const current = { ...draft, status, submittedBy: author.userId };
    for (const detail of [{}, { reason: "invalid" as never }, { reason: "other" as const, comment: "  " }, { reason: "incorrect" as const, comment: "x".repeat(1001) }]) {
      assert.throws(() => transitionPassport(current, { action: "return", version: current.version, ...detail }, author), { publicCode: "passport_rejection_required" });
    }
    const returned = transitionPassport(current, { action: "return", version: current.version, reason: "other", comment: "  Sent by mistake  " }, author);
    assert.equal(returned.status, "in_progress");
    assert.equal(returned.fileId, current.fileId);
    assert.equal(returned.uploadedBy, current.uploadedBy);
    assert.equal(returned.rejectionReason, "other");
    assert.equal(returned.rejectionComment, "Sent by mistake");
    assert.equal(returned.version, current.version + 1);
    const submitted = transitionPassport(returned, { action: "submit", version: returned.version }, author);
    assert.equal(submitted.rejectionComment, returned.rejectionComment);
    assert.equal(transitionPassport(submitted, { action: "approve", version: submitted.version }, reviewer).rejectionReason, null);
  }
});

test("rejection requires reason and comment for Other; corrected upload precedes resubmission", () => {
  const review = transitionPassport(draft, { action: "submit", version: 2 }, author);
  assert.throws(() => transitionPassport(review, { action: "reject", version: 3, reason: "other", comment: "  " }, reviewer), { publicCode: "passport_rejection_required" });
  const rejected = transitionPassport(review, { action: "reject", version: 3, reason: "other", comment: "Correct the room" }, reviewer);
  assert.equal(rejected.fileId, draft.fileId);
  assert.deepEqual(passportActions(rejected, author), ["upload"]);
  assert.throws(() => transitionPassport(rejected, { action: "submit", version: 4 }, author));
  const corrected = transitionPassport(rejected, { action: "upload", version: 4 }, author);
  assert.equal(corrected.rejectionComment, "Correct the room");
  const resubmitted = transitionPassport(corrected, { action: "submit", version: 5 }, reviewer);
  assert.equal(resubmitted.submittedBy, reviewer.userId);
  assert.equal(resubmitted.rejectionComment, corrected.rejectionComment);
  assert.equal(transitionPassport(resubmitted, { action: "approve", version: 6 }, reviewer).rejectionComment, null);
});

test("stale actions and roles outside passport management are rejected", () => {
  for (const action of ["upload", "submit", "delete"] as const) assert.throws(() => transitionPassport(draft, { action, version: 1 }, author), { publicCode: "passport_conflict" });
  for (const role of USER_ROLES.filter(role => ["employee", "warehouse", "typography"].includes(role))) assert.throws(() => transitionPassport(empty, { action: "start", version: 0 }, { ...author, role }), { publicCode: "forbidden" });
});

test("PDF validation opens valid documents and rejects empty, disguised and damaged files", async () => {
  const valid = passportPdf();
  await validatePassportPdf(valid);
  assert.equal(valid[0], 37, "validation must preserve the original upload buffer");
  for (const bytes of [new Uint8Array(), new TextEncoder().encode("renamed image.pdf"), new TextEncoder().encode("%PDF-1.7\nnot a document\n%%EOF")]) await assert.rejects(validatePassportPdf(bytes), { publicCode: "passport_invalid_pdf" });
});

test("PDF worker preserves binary data when Next.js forwards runtime globals", async () => {
  const workerData = { bytes: passportPdf({ pages: 2 }) };
  const worker = new Worker(path.resolve("lib/server/pdf/validate-passport-worker.mjs"), {
    // Match Next.js/Turbopack's object spread in its createWorker wrapper.
    workerData: { ...workerData, __turbopack_globals__: { NEXT_DEPLOYMENT_ID: "test" } },
    execArgv: [],
  });
  try {
    const result = await new Promise((resolve, reject) => {
      worker.once("message", resolve);
      worker.once("error", reject);
      worker.once("exit", code => reject(new Error(`PDF worker exited before returning a result: ${code}`)));
    });
    assert.deepEqual(result, { valid: true });
  } finally {
    await worker.terminate();
  }
});

test("PDF validation checks every page and rejects password-protected documents", async () => {
  await validatePassportPdf(passportPdf({ pages: 3 }));
  await assert.rejects(validatePassportPdf(passportPdf({ pages: 3, damagedPage: 3 })), { publicCode: "passport_invalid_pdf" });
  // A blank page encrypted with pypdf; opening requires 'test-password'.
  await assert.rejects(validatePassportPdf(await readFile(new URL("./support/encrypted-passport.pdf", import.meta.url))), { publicCode: "passport_invalid_pdf" });
});

test("PDF size limit includes exactly 20 MiB and rejects one extra byte", async () => {
  let padding = MAX_PASSPORT_BYTES - passportPdf().byteLength;
  let bytes = passportPdf({ padding });
  while (bytes.byteLength !== MAX_PASSPORT_BYTES) {
    padding += MAX_PASSPORT_BYTES - bytes.byteLength;
    bytes = passportPdf({ padding });
  }
  await validatePassportPdf(bytes);
  const oversized = new Uint8Array(MAX_PASSPORT_BYTES + 1);
  oversized.set(bytes);
  await assert.rejects(validatePassportPdf(oversized), { publicCode: "passport_invalid_pdf" });
});

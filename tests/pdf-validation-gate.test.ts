import assert from "node:assert/strict";
import { test } from "node:test";
import { PdfValidationGate } from "@/lib/server/pdf/pdf-validation-gate";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test("a parser burst is bounded and queue overflow fails without starting work", async () => {
  const gate = new PdfValidationGate({ active: 1, queued: 2, waitMs: 1000 });
  const held = deferred();
  let active = 0; let peak = 0; let started = 0;
  const work = async () => { active++; started++; peak = Math.max(peak, active); await held.promise; active--; };
  const tasks = [gate.run(work), gate.run(work), gate.run(work)];
  await assert.rejects(gate.run(work), { publicCode: "passport_pdf_busy" });
  assert.equal(started, 1);
  held.resolve(); await Promise.all(tasks);
  assert.equal(started, 3); assert.equal(peak, 1);
});

test("an expired queued upload never starts and parser errors release the slot", async () => {
  const gate = new PdfValidationGate({ active: 1, queued: 1, waitMs: 15 });
  const held = deferred();
  const first = gate.run(async () => { await held.promise; throw new Error("parser failed"); });
  const firstResult = assert.rejects(first, /parser failed/);
  let started = false;
  await assert.rejects(gate.run(async () => { started = true; }), { publicCode: "passport_pdf_busy" });
  assert.equal(started, false);
  held.resolve(); await firstResult;
  await gate.run(async () => { started = true; });
  assert.equal(started, true);
});

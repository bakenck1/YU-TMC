import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { QrResolutionDto } from "../lib/contracts/qr-resolution";
import { translate } from "../lib/i18n";
import { classifyTmcQrResolution } from "../lib/tmc-qr-flow";
import {
  TmcItemQrResolverController,
  installTmcQrResolverController,
  type TmcQrFlowState,
} from "../lib/tmc-qr-resolver";

const ACTIVE_ITEM: QrResolutionDto = {
  status: "resolved",
  canonicalKey: "YUQ1:item",
  format: "generated_v1",
  qrStatus: "active",
  target: {
    kind: "item",
    id: "0b4ad808-784f-4f84-865b-30807cc869d2",
    status: "active",
    title: "Ноутбук",
    inventoryNumber: "INV-42",
    buildingName: "Main building",
    roomDesignation: "301",
    responsibleName: null,
    isCurrentUserResponsible: false,
  },
};

test("classifies only a resolved active item as a TMC QR selection", () => {
  const result = classifyTmcQrResolution(ACTIVE_ITEM);

  assert.equal(result.kind, "selected");
  if (result.kind !== "selected") return;
  assert.equal(result.item.id, ACTIVE_ITEM.target?.id);
  assert.equal(result.item.kind, "item");
  assert.equal(result.item.status, "active");
  assert.equal(result.item.responsibleName, null);

  const optionalFields = classifyTmcQrResolution({
    ...ACTIVE_ITEM,
    target: {
      kind: "item",
      id: "5e81ce80-1675-4da7-84ac-c97e15ff123c",
      status: "active",
      title: "Стул",
    },
  });
  assert.equal(optionalFields.kind, "selected");
});

test("rejects non-item, unavailable, and unresolved QR responses explicitly", () => {
  assert.deepEqual(
    classifyTmcQrResolution({
      ...ACTIVE_ITEM,
      target: { ...ACTIVE_ITEM.target!, kind: "room", status: "active" },
    }),
    { kind: "error", reason: "not_item" },
  );

  for (const status of ["maintenance", "decommissioned"] as const) {
    assert.deepEqual(
      classifyTmcQrResolution({
        ...ACTIVE_ITEM,
        target: { ...ACTIVE_ITEM.target!, status },
      }),
      { kind: "error", reason: "item_unavailable" },
    );
  }

  for (const status of ["unknown", "unissued_system_code", "revoked"] as const) {
    assert.deepEqual(
      classifyTmcQrResolution({ ...ACTIVE_ITEM, status, target: null }),
      { kind: "error", reason: "invalid_code" },
    );
  }
  assert.deepEqual(
    classifyTmcQrResolution({ ...ACTIVE_ITEM, target: null }),
    { kind: "error", reason: "invalid_code" },
  );
  assert.deepEqual(
    classifyTmcQrResolution({ ...ACTIVE_ITEM, qrStatus: "revoked" }),
    { kind: "error", reason: "invalid_code" },
  );
});

test("TMC operation shell delegates all three operations to one QR-only flow", () => {
  const shell = readFileSync("components/TmcOperationShell.tsx", "utf8");
  const flow = readFileSync("components/TmcItemQrFlow.tsx", "utf8");
  const scanner = readFileSync("components/InventoryItemCodeScanner.tsx", "utf8");
  const resolver = readFileSync("lib/tmc-qr-resolver.ts", "utf8");

  assert.match(shell, /<TmcItemQrFlow operation=\{operation\}/);
  assert.match(flow, /InventoryItemCodeScanner/);
  assert.match(flow, /mode="qr-only"/);
  assert.match(flow, /TmcItemQrResolverController/);
  assert.match(flow, /useEffect\(\(\) =>\s*installTmcQrResolverController/);
  assert.match(resolver, /\/api\/inventory\/qr\/resolve\?value=\$\{encodeURIComponent\(normalized\)\}&kind=qr&target=item/);
  assert.match(resolver, /credentials: "same-origin"/);
  assert.match(resolver, /cache: "no-store"/);
  assert.match(resolver, /classifyTmcQrResolution/);
  assert.match(scanner, /mode\?: "default" \| "qr-only"/);
  assert.match(scanner, /qrOnly \? "tmc\.qr\.scannerHint" : "scanner\.itemHint"/);
  assert.match(scanner, /event\.key === "Escape"/);
  assert.match(scanner, /event\.key !== "Tab"/);
  assert.match(scanner, /max-h-\[100dvh\]/);
  assert.match(scanner, /min-h-11 min-w-11/);
  assert.match(scanner, /htmlFor=\{manualInputId\}/);
  assert.match(scanner, /id=\{manualInputId\}/);
  assert.match(scanner, /<video[^>]+aria-hidden="true"/);
  assert.doesNotMatch(flow, /method:\s*["']POST|\/transfers|history/i);
});

test("QR resolver coalesces duplicate scans and publishes one selected item", async () => {
  const requests: ControlledRequest[] = [];
  const states: TmcQrFlowState[] = [];
  const controller = createController(requests, states);

  const first = controller.resolve("  YUQ1:first  ");
  await controller.resolve("YUQ1:duplicate");
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /value=YUQ1%3Afirst&kind=qr&target=item$/);

  requests[0].resolve(okResponse(ACTIVE_ITEM));
  await first;
  const selected = states.at(-1);
  assert.equal(selected?.status, "selected");
  assert.equal(selected?.status === "selected" ? selected.item.id : null, ACTIVE_ITEM.target?.id);
});

test("reset aborts pending work and stale responses cannot replace a newer scan", async () => {
  const requests: ControlledRequest[] = [];
  const states: TmcQrFlowState[] = [];
  const controller = createController(requests, states);

  const stale = controller.resolve("YUQ1:stale");
  controller.reset();
  assert.equal(requests[0].signal.aborted, true);
  const current = controller.resolve("YUQ1:current");

  requests[0].resolve(okResponse(ACTIVE_ITEM));
  await stale;
  assert.notEqual(states.at(-1)?.status, "selected");

  const currentItem = {
    ...ACTIVE_ITEM,
    target: { ...ACTIVE_ITEM.target!, id: "188994a0-e061-419f-a97e-5f20cdba539d" },
  };
  requests[1].resolve(okResponse(currentItem));
  await current;
  const selected = states.at(-1);
  assert.equal(
    selected?.status === "selected" ? selected.item.id : null,
    currentItem.target.id,
  );
});

test("dispose aborts without publishing late state", async () => {
  const requests: ControlledRequest[] = [];
  const states: TmcQrFlowState[] = [];
  const controller = createController(requests, states);
  const pending = controller.resolve("YUQ1:late");
  const publishedBeforeDispose = states.length;

  controller.dispose();
  assert.equal(requests[0].signal.aborted, true);
  requests[0].resolve(okResponse(ACTIVE_ITEM));
  await pending;
  assert.equal(states.length, publishedBeforeDispose);
});

test("QR resolver exposes retryable errors but ignores AbortError", async () => {
  const states: TmcQrFlowState[] = [];
  const responses = [
    Promise.resolve({ ok: false, json: async () => ({}) }),
    Promise.resolve({ ok: true, json: async () => ({ malformed: true }) }),
    Promise.reject(new Error("offline")),
    Promise.resolve(okResponse({ ...ACTIVE_ITEM, qrStatus: "revoked" })),
    Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
  ];
  const controller = new TmcItemQrResolverController({
    fetcher: async () => responses.shift()!,
    onState: (state) => states.push(state),
  });

  for (let index = 0; index < 4; index += 1) {
    await controller.resolve(`YUQ1:error-${index}`);
    assert.deepEqual(states.at(-1), {
      status: "error",
      reason: "request_failed",
    });
    controller.reset();
  }
  await controller.resolve("YUQ1:abort");
  assert.equal(states.at(-1)?.status, "idle");
});

test("Strict Mode effect replay replaces a disposed QR resolver", async () => {
  const requests: ControlledRequest[] = [];
  const states: TmcQrFlowState[] = [];
  const target: { current: TmcItemQrResolverController | null } = {
    current: null,
  };
  const options = {
    fetcher: (url: string, init: { signal: AbortSignal }) =>
      new Promise<{ ok: boolean; json(): Promise<unknown> }>((resolve) => {
        requests.push({ url, signal: init.signal, resolve });
      }),
    onState: (state: TmcQrFlowState) => states.push(state),
  };

  const firstCleanup = installTmcQrResolverController(target, options);
  const first = target.current;
  firstCleanup();
  assert.equal(target.current, null);

  const secondCleanup = installTmcQrResolverController(target, options);
  assert.notEqual(target.current, first);
  const pending = target.current!.resolve("YUQ1:strict-mode");
  assert.equal(requests.length, 1);
  requests[0].resolve(okResponse(ACTIVE_ITEM));
  await pending;
  assert.equal(states.at(-1)?.status, "selected");
  secondCleanup();
});

test("QR flow copy is complete in RU, KK and EN", () => {
  const expected = {
    "tmc.qr.scan": ["Сканировать QR", "QR сканерлеу", "Scan QR"],
    "tmc.qr.scannerHint": [
      "Наведите камеру на QR-код ТМЦ или введите код вручную.",
      "Камераны ТМҚ QR-кодына бағыттаңыз немесе кодты қолмен енгізіңіз.",
      "Point the camera at the item QR code or enter it manually.",
    ],
    "tmc.qr.scanAgain": ["Сканировать снова", "Қайта сканерлеу", "Scan again"],
    "tmc.qr.remove": ["Убрать ТМЦ", "ТМҚ-ны алып тастау", "Remove item"],
    "tmc.qr.resolving": ["Проверяем QR…", "QR тексерілуде…", "Checking QR…"],
    "tmc.qr.invalidCode": [
      "QR-код не зарегистрирован или больше не действует.",
      "QR-код тіркелмеген немесе енді жарамсыз.",
      "This QR code is not registered or is no longer valid.",
    ],
    "tmc.qr.notItem": [
      "Этот QR-код не относится к ТМЦ.",
      "Бұл QR-код ТМҚ-ға тиесілі емес.",
      "This QR code does not belong to an inventory item.",
    ],
    "tmc.qr.itemUnavailable": [
      "Этот ТМЦ сейчас недоступен для операции.",
      "Бұл ТМҚ қазір операция үшін қолжетімсіз.",
      "This inventory item is currently unavailable for the operation.",
    ],
    "tmc.qr.requestFailed": [
      "Не удалось проверить QR. Повторите попытку.",
      "QR тексеру мүмкін болмады. Қайталап көріңіз.",
      "Could not check the QR code. Try again.",
    ],
    "tmc.qr.noResponsible": [
      "Не закреплён",
      "Жауапты тұлға бекітілмеген",
      "Unassigned",
    ],
  } as const;

  for (const [key, values] of Object.entries(expected)) {
    assert.deepEqual(
      (["ru", "kk", "en"] as const).map((language) =>
        translate(language, key as keyof typeof expected),
      ),
      values,
    );
  }
});

interface ControlledRequest {
  url: string;
  signal: AbortSignal;
  resolve(response: { ok: boolean; json(): Promise<unknown> }): void;
}

function createController(
  requests: ControlledRequest[],
  states: TmcQrFlowState[],
) {
  return new TmcItemQrResolverController({
    fetcher: (url, init) =>
      new Promise((resolve) => {
        requests.push({ url, signal: init.signal as AbortSignal, resolve });
      }),
    onState: (state) => states.push(state),
  });
}

function okResponse(resolution: QrResolutionDto) {
  return { ok: true, json: async () => ({ resolution }) };
}

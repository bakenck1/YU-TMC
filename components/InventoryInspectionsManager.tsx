"use client";

import { useEffect, useRef, useState } from "react";
import {
  Barcode,
  Camera,
  ClipboardCheck,
  FileSpreadsheet,
  Plus,
  QrCode,
  ScanLine,
  WifiOff,
  X,
} from "lucide-react";
import type { InspectionDto } from "@/lib/contracts/inventory-inspections";
import type { RoomDto } from "@/lib/contracts/inventory-locations";
import type { QrResolutionDto } from "@/lib/contracts/qr-resolution";
import type {
  ItemResultDto,
  RecordItemResultInput,
} from "@/lib/contracts/inventory-inspection-results";
import type { UserRole } from "@/lib/contracts/users";
import {
  applyInspectionResult,
  firstInspectionRoomId,
} from "@/lib/inventory-inspection-selection";
import {
  startBarcodeScanner,
  type BarcodeScannerSession,
} from "@/lib/browser-barcode-scanner";
import PushNotificationControl from "@/components/PushNotificationControl";
import { useAppSettings } from "@/components/AppSettingsProvider";
import { translateCampusBuilding, type TranslationKey } from "@/lib/i18n";

interface InspectionTechnician {
  id: string;
  fullName: string;
  role: "warehouse" | "employee";
}

export default function InventoryInspectionsManager({
  actorRole,
  currentUserId,
  initialInspections,
  initialInspectionId,
  rooms,
  technicians,
  canExport,
}: {
  actorRole: UserRole;
  currentUserId: string;
  initialInspections: InspectionDto[];
  initialInspectionId: string | null;
  rooms: RoomDto[];
  technicians: InspectionTechnician[];
  canExport: boolean;
}) {
  const { language, locale, t } = useAppSettings();
  const [inspections, setInspections] = useState(initialInspections);
  const [name, setName] = useState("");
  const [deadline, setDeadline] = useState("");
  const [selectedTechnician, setSelectedTechnician] = useState(
    actorRole === "admin" ? technicians[0]?.id ?? "" : currentUserId,
  );
  const initialSelectedInspectionId =
    initialInspectionId ?? initialInspections[0]?.id ?? null;
  const [selectedCatalogRoom, setSelectedCatalogRoom] = useState(
    rooms[0]?.id ?? "",
  );
  const [selectedInspection, setSelectedInspection] = useState<string | null>(
    initialSelectedInspectionId,
  );
  const [selectedInspectionRoom, setSelectedInspectionRoom] = useState(
    firstInspectionRoomId(initialInspections, initialSelectedInspectionId),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [qrValue, setQrValue] = useState("");
  const [codeFormat, setCodeFormat] = useState<"code_39" | "qr_code">(
    "code_39",
  );
  const [resolution, setResolution] = useState<QrResolutionDto | null>(null);
  const [recordedResult, setRecordedResult] = useState<ItemResultDto | null>(null);
  const [resultComment, setResultComment] = useState("");
  const [online, setOnline] = useState(true);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerSessionRef = useRef<BarcodeScannerSession | null>(null);
  const cameraRequestRef = useRef(0);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      stopCamera();
    };
  }, []);

  async function createInspection() {
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/inventory/inspections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, technicianId: selectedTechnician, deadlineAt: deadline ? new Date(`${deadline}T23:59:59`).toISOString() : undefined }),
      });
      const body = (await response.json()) as {
        inspection?: InspectionDto;
        error?: string;
      };
      if (!response.ok || !body.inspection) {
        throw new Error(body.error ?? "create_failed");
      }
      setInspections((current) => [body.inspection!, ...current]);
      setSelectedInspection(body.inspection.id);
      setSelectedInspectionRoom("");
      setName("");
      setDeadline("");
    } catch (cause) {
      void cause;
      setError(t("inspections.operationFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function addRoom() {
    const inspection = inspections.find((entry) => entry.id === selectedInspection);
    const room = rooms.find((entry) => entry.id === selectedCatalogRoom);
    if (!inspection || !room) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/inventory/inspections/${inspection.id}/rooms`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ buildingId: room.buildingId, roomId: room.id }),
        },
      );
      const body = (await response.json()) as {
        room?: InspectionDto["rooms"][number];
        inspection?: InspectionDto;
        error?: string;
      };
      if (!response.ok || !body.room) throw new Error(body.error ?? "room_failed");
      setInspections((current) =>
        current.map((entry) =>
          entry.id === inspection.id
            ? body.inspection ?? { ...entry, rooms: [...entry.rooms, body.room!] }
            : entry,
        ),
      );
      setSelectedInspectionRoom(body.room.roomId);
    } catch (cause) {
      void cause;
      setError(t("inspections.operationFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function resolveQr(scannedValue = qrValue) {
    if (!scannedValue.trim() || !online) return;
    setBusy(true);
    setError("");
    setResolution(null);
    setRecordedResult(null);
    try {
      const response = await fetch(
        `/api/inventory/qr/resolve?value=${encodeURIComponent(scannedValue)}&kind=${codeFormat === "code_39" ? "barcode" : "qr"}`,
      );
      const body = (await response.json()) as {
        resolution?: QrResolutionDto;
        error?: string;
      };
      if (!response.ok || !body.resolution) {
        throw new Error(body.error ?? "qr_resolve_failed");
      }
      setResolution(body.resolution);
    } catch (cause) {
      void cause;
      setError(t("inspections.operationFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function recordResult(result: RecordItemResultInput["result"]) {
    const inspection = inspections.find((entry) => entry.id === selectedInspection);
    const inspectionRoom = inspection?.rooms.find(
      (room) => room.roomId === selectedInspectionRoom,
    );
    const itemId = resolution?.target?.kind === "item" ? resolution.target.id : null;
    if (!inspection || !inspectionRoom || !itemId) {
      setError(t("inspections.selectDraftError"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/inventory/inspections/${inspection.id}/rooms/${inspectionRoom.id}/results`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ itemId, result, comment: resultComment || null }),
        },
      );
      const body = (await response.json()) as {
        result?: ItemResultDto;
        error?: string;
      };
      if (!response.ok || !body.result) {
        throw new Error(body.error ?? "result_record_failed");
      }
      setRecordedResult(body.result);
      setResultComment("");
      setInspections((current) => applyInspectionResult(current, body.result!));
    } catch (cause) {
      void cause;
      setError(t("inspections.operationFailed"));
    } finally {
      setBusy(false);
    }
  }

  function stopCamera() {
    cameraRequestRef.current += 1;
    scannerSessionRef.current?.stop();
    scannerSessionRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOpen(false);
  }

  async function startCamera() {
    stopCamera();
    const requestId = ++cameraRequestRef.current;
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(t("inspections.cameraUnsupported"));
      return;
    }
    try {
      setCameraOpen(true);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const video = videoRef.current;
      if (!video || requestId !== cameraRequestRef.current) return;
      const session = await startBarcodeScanner({
        video,
        format: codeFormat,
        onDetected(value) {
          if (requestId !== cameraRequestRef.current) return;
          setQrValue(value);
          navigator.vibrate?.(60);
          stopCamera();
          void resolveQr(value);
        },
      });
      if (requestId !== cameraRequestRef.current) {
        session.stop();
        return;
      }
      scannerSessionRef.current = session;
    } catch (cause) {
      if (requestId === cameraRequestRef.current) {
        stopCamera();
        setCameraError(
          cause instanceof DOMException && cause.name === "NotAllowedError"
            ? t("inspections.cameraDenied")
            : t("inspections.cameraFailed"),
        );
      }
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
          <ClipboardCheck className="h-6 w-6 text-emerald-500" />
          <div>
            <h1 className="text-xl font-semibold text-zinc-800">
              {t("inspections.title")}
            </h1>
            <p className="text-sm text-zinc-500">
              {t("inspections.subtitle")}
            </p>
          </div>
          </div>
          {canExport ? <a href="/api/inventory/excel?action=export&dataset=inspection-results" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-semibold text-emerald-700"><FileSpreadsheet className="h-4 w-4" />{t("excel.exportResults")}</a> : null}
        </div>
        {actorRole !== "employee" ? (
          <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(13rem,0.7fr)_12rem_auto]">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("inspections.namePlaceholder")}
              className="min-w-0 rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500"
            />
            {actorRole === "admin" ? (
              <select
                value={selectedTechnician}
                onChange={(event) => setSelectedTechnician(event.target.value)}
                aria-label={t("inspections.assignee")}
                className="min-w-0 rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
              >
                {technicians.map((technician) => (
                  <option key={technician.id} value={technician.id}>
                    {technician.fullName} ·{" "}
                    {t(
                      technician.role === "warehouse"
                        ? "inspections.roleWarehouse"
                        : "inspections.roleEmployee",
                    )}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex items-center rounded-xl bg-zinc-50 px-3 py-2.5 text-sm text-zinc-600">
                {t("inspections.assigneeSelf")}
              </div>
            )}
            <input type="date" value={deadline} min={new Date().toISOString().slice(0, 10)} onChange={(event) => setDeadline(event.target.value)} aria-label={t("inspections.deadline")} className="min-w-0 rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
            <button
              type="button"
              onClick={() => void createInspection()}
              disabled={busy || !name.trim() || !selectedTechnician || !deadline}
              className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> {t("inspections.create")}
            </button>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
        <div className="mb-3">
          <h2 className="font-semibold text-zinc-800">
            {t("inspections.notificationsTitle")}
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            {t("inspections.notificationsHint")}
          </p>
        </div>
        <PushNotificationControl />
      </section>

      <section className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <ScanLine className="h-5 w-5 text-emerald-500" />
          <h2 className="font-semibold text-zinc-800">
            {t("inspections.scanTitle")}
          </h2>
        </div>
        <div className="mt-4 grid max-w-sm grid-cols-2 gap-2 rounded-xl bg-zinc-100 p-1">
          <button
            type="button"
            onClick={() => {
              stopCamera();
              setCodeFormat("code_39");
            }}
            aria-pressed={codeFormat === "code_39"}
            className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold ${codeFormat === "code_39" ? "bg-white text-emerald-700 shadow-sm" : "text-zinc-500"}`}
          >
            <Barcode className="h-4 w-4" /> {t("itemDetails.barcode")}
          </button>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              setCodeFormat("qr_code");
            }}
            aria-pressed={codeFormat === "qr_code"}
            className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold ${codeFormat === "qr_code" ? "bg-white text-emerald-700 shadow-sm" : "text-zinc-500"}`}
          >
            <QrCode className="h-4 w-4" /> QR
          </button>
        </div>
        {!online ? (
          <p role="status" className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <WifiOff className="h-4 w-4" /> {t("inspections.offline")}
          </p>
        ) : null}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            value={qrValue}
            onChange={(event) => setQrValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void resolveQr();
            }}
            placeholder={t("inspections.codePlaceholder")}
            className="min-w-0 flex-1 rounded-xl border border-black/10 px-3 py-2.5 font-mono text-sm outline-none focus:border-emerald-500"
          />
          <button
            type="button"
            onClick={() => void resolveQr()}
            disabled={busy || !online || !qrValue.trim()}
            className="rounded-xl bg-zinc-800 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {t("inspections.resolve")}
          </button>
          <button
            type="button"
            onClick={() => void startCamera()}
            disabled={busy || !online}
            className="flex items-center justify-center gap-2 rounded-xl border border-black/10 px-4 py-2.5 text-sm font-medium text-zinc-700 disabled:opacity-50"
          >
            <Camera className="h-4 w-4" /> {t("inspections.camera")}
          </button>
        </div>
        {cameraError ? (
          <p role="alert" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {cameraError}
          </p>
        ) : null}
        {cameraOpen ? (
          <div className="relative mt-4 overflow-hidden rounded-xl bg-black">
            <video ref={videoRef} muted playsInline className="aspect-[4/3] w-full object-cover" />
            <button
              type="button"
              onClick={stopCamera}
              aria-label={t("inspections.closeCamera")}
              className="absolute right-3 top-3 rounded-full bg-black/60 p-2 text-white"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="pointer-events-none absolute inset-1/4 rounded-xl border-2 border-emerald-400" />
          </div>
        ) : null}
        {resolution ? (
          <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm">
            <p className="font-medium text-zinc-800">
              {resolution.status === "resolved" && resolution.target
                ? `${t(TARGET_KIND_KEYS[resolution.target.kind])}: ${resolution.target.title}`
                : t(
                    resolution.status === "resolved"
                      ? "inspections.resolution.unknown"
                      : RESOLUTION_STATUS_KEYS[resolution.status],
                  )}
            </p>
            {resolution.target ? (
              <p className="mt-1 text-zinc-500">
                {resolution.target.buildingName
                  ? translateCampusBuilding(language, resolution.target.buildingName)
                  : ""}
                {resolution.target.roomDesignation
                  ? ` · ${resolution.target.roomDesignation}`
                  : ""}
                {resolution.target.inventoryNumber
                  ? ` · ${resolution.target.inventoryNumber}`
                  : ""}
              </p>
            ) : (
              <p className="mt-1 text-zinc-500">
                {t("inspections.notFound")}
              </p>
            )}
            {resolution.target?.kind === "item" ? (
              <div className="mt-4 border-t border-black/5 pt-4">
                <p className="text-sm font-medium text-zinc-700">
                  {t("inspections.resultTitle")}
                </p>
                {recordedResult ? (
                  <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    {t("inspections.savedResult", {
                      result: resultLabel(recordedResult.result, t),
                    })}
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    <textarea
                      value={resultComment}
                      onChange={(event) => setResultComment(event.target.value)}
                      maxLength={1000}
                      rows={2}
                      placeholder={t("inspections.commentPlaceholder")}
                      className="w-full resize-none rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    />
                    {!selectedInspection || !inspections
                      .find((inspection) => inspection.id === selectedInspection)
                      ?.rooms.some(
                        (room) => room.roomId === selectedInspectionRoom,
                      ) ? (
                      <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        {t("inspections.selectDraftRoom")}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      {RESULT_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => void recordResult(option.value)}
                          disabled={busy}
                          className="rounded-lg border border-black/10 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-white disabled:opacity-50"
                        >
                          {t(option.labelKey)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {inspections.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-black/10 bg-white p-10 text-center text-sm text-zinc-500">
          {t("inspections.empty")}
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {inspections.map((inspection) => (
            <article
              key={inspection.id}
              className={`rounded-2xl border bg-white p-5 shadow-sm ${
                selectedInspection === inspection.id
                  ? "border-emerald-300"
                  : "border-black/5"
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  setSelectedInspection(inspection.id);
                  setSelectedInspectionRoom(
                    firstInspectionRoomId(inspections, inspection.id),
                  );
                }}
                className="w-full text-left"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-zinc-800">{inspection.name}</h2>
                    <p className="mt-1 text-xs text-zinc-400">
                      {technicians.find(
                        (technician) => technician.id === inspection.technicianId,
                      )?.fullName ?? t("inspections.assignedTechnician")}{" "}
                      · {new Date(inspection.updatedAt).toLocaleString(locale)}
                      {" · "}{t("inspections.deadline")}: {new Date(inspection.deadlineAt).toLocaleDateString(locale)}
                    </p>
                  </div>
                  <span className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700">
                    {t(INSPECTION_DISPLAY_STATUS_KEYS[inspection.displayStatus])}
                  </span>
                </div>
              </button>
              <div className="mt-4 border-t border-black/5 pt-4">
                <InspectionProgress inspection={inspection} />
                <div className="mb-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <ReportMetric label={t("inspections.reportPresent")} value={inspection.progress.present} />
                  <ReportMetric label={t("inspections.reportMissing")} value={inspection.progress.missing} />
                  <ReportMetric label={t("inspections.reportUnchecked")} value={inspection.progress.unchecked} />
                  <ReportMetric label={t("inspections.reportComments")} value={inspection.progress.comments} />
                </div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                  {t("inspections.rooms", { count: inspection.rooms.length })}
                </p>
                <ul className="mt-2 space-y-1 text-sm text-zinc-600">
                  {inspection.rooms.map((room) => (
                    <li key={room.id}>
                      {translateCampusBuilding(language, room.buildingName)} · {room.roomDesignation}
                    </li>
                  ))}
                </ul>
                {inspection.items.length ? (
                  <div className="mt-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">{t("inspections.itemStatuses")}</p>
                    <ul className="mt-2 max-h-52 space-y-1 overflow-y-auto text-sm">
                      {inspection.items.map((expected) => {
                        const result = inspection.results.find((entry) => entry.itemId === expected.itemId);
                        return <li key={expected.itemId} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2"><span className="truncate text-zinc-700">{expected.itemName} · {expected.inventoryNumber}</span><span className={result?.result === "missing" ? "text-red-600" : result ? "text-emerald-600" : "text-zinc-400"}>{result?.result === "missing" ? t("inspections.reportMissing") : result ? t("inspections.reportChecked") : t("inspections.reportUnchecked")}</span></li>;
                      })}
                    </ul>
                  </div>
                ) : null}
                {selectedInspection === inspection.id &&
                inspection.rooms.length > 0 ? (
                  <label className="mt-4 block text-xs font-medium text-zinc-500">
                    {t("inspections.scanRoom")}
                    <select
                      value={selectedInspectionRoom}
                      onChange={(event) =>
                        setSelectedInspectionRoom(event.target.value)
                      }
                      className="mt-1 w-full rounded-lg border border-black/10 bg-white px-2 py-2 text-sm text-zinc-700"
                    >
                      {inspection.rooms.map((room) => (
                        <option key={room.id} value={room.roomId}>
                          {translateCampusBuilding(language, room.buildingName)} · {room.roomDesignation}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {inspection.results.length ? (
                  <div className="mt-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                      {t("inspections.recordedItems", {
                        count: inspection.results.length,
                      })}
                    </p>
                    <ul className="mt-2 space-y-1 text-sm text-zinc-600">
                      {inspection.results.map((result) => (
                        <li key={result.id}>
                          {result.itemName} · {result.inventoryNumber} ·{" "}
                          {resultLabel(result.result, t)} ·{" "}
                          {new Date(result.createdAt).toLocaleString(locale)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {selectedInspection === inspection.id &&
                inspection.status === "draft" &&
                rooms.length > 0 ? (
                  <div className="mt-4 flex gap-2">
                    <select
                      value={selectedCatalogRoom}
                      onChange={(event) =>
                        setSelectedCatalogRoom(event.target.value)
                      }
                      className="min-w-0 flex-1 rounded-lg border border-black/10 bg-white px-2 py-2 text-sm"
                    >
                      {rooms.map((room) => (
                        <option key={room.id} value={room.id}>
                          {room.designation} ·{" "}
                          {t("inspections.floor", {
                            floor: room.floorNumber,
                          })}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void addRoom()}
                      disabled={busy}
                      className="rounded-lg border border-emerald-200 px-3 py-2 text-sm font-medium text-emerald-700 disabled:opacity-50"
                    >
                      {t("inspections.add")}
                    </button>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function InspectionProgress({ inspection }: { inspection: InspectionDto }) {
  const { t } = useAppSettings();
  const { checked: completed, total, percent } = inspection.progress;
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>{t("inspections.progress")}</span>
        <span>{t("inspections.progressItems", { completed, total })} · {percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={t("inspections.progress")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"
      >
        <div className="h-full rounded-full bg-emerald-500 transition-[width]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function ReportMetric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-zinc-400">{label}</p><p className="mt-1 font-semibold text-zinc-800">{value}</p></div>;
}

const RESULT_OPTIONS: Array<{
  value: RecordItemResultInput["result"];
  labelKey: TranslationKey;
}> = [
  { value: "present", labelKey: "inspections.result.present" },
  { value: "missing", labelKey: "inspections.result.missing" },
  { value: "moved", labelKey: "inspections.result.moved" },
  { value: "broken", labelKey: "inspections.result.broken" },
  { value: "undetermined", labelKey: "inspections.result.undetermined" },
];

const INSPECTION_DISPLAY_STATUS_KEYS: Record<
  InspectionDto["displayStatus"],
  TranslationKey
> = {
  draft: "inspections.status.draft",
  in_progress: "inspections.status.inProgress",
  completed: "inspections.status.completed",
  overdue: "inspections.status.overdue",
};

const TARGET_KIND_KEYS: Record<
  NonNullable<QrResolutionDto["target"]>["kind"],
  TranslationKey
> = {
  item: "inspections.target.item",
  room: "inspections.target.room",
  building: "inspections.target.building",
};

const RESOLUTION_STATUS_KEYS: Record<
  Exclude<QrResolutionDto["status"], "resolved">,
  TranslationKey
> = {
  revoked: "inspections.resolution.revoked",
  unissued_system_code: "inspections.resolution.unissued_system_code",
  unknown: "inspections.resolution.unknown",
};

function resultLabel(
  value: RecordItemResultInput["result"],
  t: ReturnType<typeof useAppSettings>["t"],
) {
  const key = RESULT_OPTIONS.find((option) => option.value === value)?.labelKey;
  return key ? t(key) : value;
}

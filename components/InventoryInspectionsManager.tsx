"use client";

import { useEffect, useRef, useState } from "react";
import {
  Barcode,
  Camera,
  ClipboardCheck,
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
import { firstInspectionRoomId } from "@/lib/inventory-inspection-selection";
import {
  startBarcodeScanner,
  type BarcodeScannerSession,
} from "@/lib/browser-barcode-scanner";
import PushNotificationControl from "@/components/PushNotificationControl";

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
}: {
  actorRole: UserRole;
  currentUserId: string;
  initialInspections: InspectionDto[];
  initialInspectionId: string | null;
  rooms: RoomDto[];
  technicians: InspectionTechnician[];
}) {
  const [inspections, setInspections] = useState(initialInspections);
  const [name, setName] = useState("");
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
        body: JSON.stringify({ name, technicianId: selectedTechnician }),
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "create_failed");
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
        error?: string;
      };
      if (!response.ok || !body.room) throw new Error(body.error ?? "room_failed");
      setInspections((current) =>
        current.map((entry) =>
          entry.id === inspection.id
            ? { ...entry, rooms: [...entry.rooms, body.room!] }
            : entry,
        ),
      );
      setSelectedInspectionRoom(body.room.roomId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "room_failed");
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
      setError(cause instanceof Error ? cause.message : "qr_resolve_failed");
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
      setError("Выберите черновик проверки и кабинет, добавленный в него.");
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
      setInspections((current) =>
        current.map((entry) =>
          entry.id === inspection.id &&
          !entry.results.some((existing) => existing.id === body.result!.id)
            ? { ...entry, results: [...entry.results, body.result!] }
            : entry,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "result_record_failed");
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
      setCameraError("Камера не поддерживается этим браузером.");
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
            ? "Доступ к камере отклонён. Разрешите камеру или используйте ручной ввод."
            : "Не удалось открыть камеру.",
        );
      }
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <ClipboardCheck className="h-6 w-6 text-emerald-500" />
          <div>
            <h1 className="text-xl font-semibold text-zinc-800">Инвентаризация</h1>
            <p className="text-sm text-zinc-500">
              Черновики и завершённые проверки техника
            </p>
          </div>
        </div>
        {actorRole !== "employee" ? (
          <div className="mt-5 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(13rem,0.7fr)_auto]">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Название проверки"
              className="min-w-0 rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500"
            />
            {actorRole === "admin" ? (
              <select
                value={selectedTechnician}
                onChange={(event) => setSelectedTechnician(event.target.value)}
                aria-label="Ответственный техник"
                className="min-w-0 rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
              >
                {technicians.map((technician) => (
                  <option key={technician.id} value={technician.id}>
                    {technician.fullName} ·{" "}
                    {technician.role === "warehouse" ? "Кладовщик" : "Сотрудник"}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex items-center rounded-xl bg-zinc-50 px-3 py-2.5 text-sm text-zinc-600">
                Исполнитель: вы
              </div>
            )}
            <button
              type="button"
              onClick={() => void createInspection()}
              disabled={busy || !name.trim() || !selectedTechnician}
              className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Создать проверку
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
          <h2 className="font-semibold text-zinc-800">Уведомления о назначениях</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Подписка действует на этом устройстве и отключается при выходе.
          </p>
        </div>
        <PushNotificationControl />
      </section>

      <section className="rounded-2xl border border-black/5 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <ScanLine className="h-5 w-5 text-emerald-500" />
          <h2 className="font-semibold text-zinc-800">Сканирование кода ТМЦ</h2>
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
            <Barcode className="h-4 w-4" /> Code 39
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
            <WifiOff className="h-4 w-4" /> Для распознавания требуется подключение к сети.
          </p>
        ) : null}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            value={qrValue}
            onChange={(event) => setQrValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void resolveQr();
            }}
            placeholder="Инвентарный номер, YUQ1:… или старый код"
            className="min-w-0 flex-1 rounded-xl border border-black/10 px-3 py-2.5 font-mono text-sm outline-none focus:border-emerald-500"
          />
          <button
            type="button"
            onClick={() => void resolveQr()}
            disabled={busy || !online || !qrValue.trim()}
            className="rounded-xl bg-zinc-800 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Распознать
          </button>
          <button
            type="button"
            onClick={() => void startCamera()}
            disabled={busy || !online}
            className="flex items-center justify-center gap-2 rounded-xl border border-black/10 px-4 py-2.5 text-sm font-medium text-zinc-700 disabled:opacity-50"
          >
            <Camera className="h-4 w-4" /> Камера
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
              aria-label="Закрыть камеру"
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
              {resolution.status === "resolved"
                ? `${resolution.target?.kind}: ${resolution.target?.title}`
                : resolution.status}
            </p>
            {resolution.target ? (
              <p className="mt-1 text-zinc-500">
                {resolution.target.buildingName ?? ""}
                {resolution.target.roomDesignation
                  ? ` · ${resolution.target.roomDesignation}`
                  : ""}
                {resolution.target.inventoryNumber
                  ? ` · ${resolution.target.inventoryNumber}`
                  : ""}
              </p>
            ) : (
              <p className="mt-1 text-zinc-500">
                Объект не найден; текущая проверка и выбранные кабинеты сохранены.
              </p>
            )}
            {resolution.target?.kind === "item" ? (
              <div className="mt-4 border-t border-black/5 pt-4">
                <p className="text-sm font-medium text-zinc-700">Результат проверки</p>
                {recordedResult ? (
                  <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    Сохранено: {resultLabel(recordedResult.result)}
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    <textarea
                      value={resultComment}
                      onChange={(event) => setResultComment(event.target.value)}
                      maxLength={1000}
                      rows={2}
                      placeholder="Комментарий (необязательно)"
                      className="w-full resize-none rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    />
                    {!selectedInspection || !inspections
                      .find((inspection) => inspection.id === selectedInspection)
                      ?.rooms.some(
                        (room) => room.roomId === selectedInspectionRoom,
                      ) ? (
                      <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        Сначала создайте или выберите черновик проверки и добавьте в него нужный кабинет. После этого результат будет сохранён.
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
                          {option.label}
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
          Проверок пока нет.
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
                      )?.fullName ?? "Назначенный техник"}{" "}
                      · {new Date(inspection.updatedAt).toLocaleString()}
                    </p>
                  </div>
                  <span className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700">
                    {inspection.status}
                  </span>
                </div>
              </button>
              <div className="mt-4 border-t border-black/5 pt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                  Кабинеты ({inspection.rooms.length})
                </p>
                <ul className="mt-2 space-y-1 text-sm text-zinc-600">
                  {inspection.rooms.map((room) => (
                    <li key={room.id}>
                      {room.buildingName} · {room.roomDesignation}
                    </li>
                  ))}
                </ul>
                {selectedInspection === inspection.id &&
                inspection.rooms.length > 0 ? (
                  <label className="mt-4 block text-xs font-medium text-zinc-500">
                    Кабинет для сканирования
                    <select
                      value={selectedInspectionRoom}
                      onChange={(event) =>
                        setSelectedInspectionRoom(event.target.value)
                      }
                      className="mt-1 w-full rounded-lg border border-black/10 bg-white px-2 py-2 text-sm text-zinc-700"
                    >
                      {inspection.rooms.map((room) => (
                        <option key={room.id} value={room.roomId}>
                          {room.buildingName} · {room.roomDesignation}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {inspection.results.length ? (
                  <div className="mt-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                      Зафиксированные предметы ({inspection.results.length})
                    </p>
                    <ul className="mt-2 space-y-1 text-sm text-zinc-600">
                      {inspection.results.map((result) => (
                        <li key={result.id}>
                          {result.itemName} · {result.inventoryNumber} · {resultLabel(result.result)} · {new Date(result.createdAt).toLocaleString()}
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
                          {room.designation} · этаж {room.floorNumber}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void addRoom()}
                      disabled={busy}
                      className="rounded-lg border border-emerald-200 px-3 py-2 text-sm font-medium text-emerald-700 disabled:opacity-50"
                    >
                      Добавить
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

const RESULT_OPTIONS: Array<{
  value: RecordItemResultInput["result"];
  label: string;
}> = [
  { value: "present", label: "На месте" },
  { value: "missing", label: "Отсутствует" },
  { value: "moved", label: "Перемещён" },
  { value: "broken", label: "Неисправен" },
  { value: "undetermined", label: "Не удалось определить" },
];

function resultLabel(value: RecordItemResultInput["result"]) {
  return RESULT_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

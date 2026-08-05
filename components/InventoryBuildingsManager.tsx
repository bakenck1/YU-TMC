"use client";

import { useState, type FormEvent } from "react";
import {
  Building2,
  DoorOpen,
  LoaderCircle,
  MapPin,
  Plus,
  QrCode,
  ScanLine,
  Trash2,
  X,
} from "lucide-react";

import type {
  BuildingDto,
  RoomDto,
} from "@/lib/contracts/inventory-locations";
import type { UserRole } from "@/lib/contracts/users";
import {
  CAMPUS_INVENTORY_BUILDING_PRESETS,
  findCampusBuildingPreset,
} from "@/lib/campus-directory";
import { hasPermission } from "@/lib/security/permissions";
import { useAppSettings } from "@/components/AppSettingsProvider";
import InventoryItemCreateForm from "@/components/InventoryItemCreateForm";
import InventoryRoomQrScanner from "@/components/InventoryRoomQrScanner";
import { translateCampusBuilding, type TranslationKey } from "@/lib/i18n";

const INPUT_CLASS =
  "mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm text-zinc-800 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10";

export default function InventoryBuildingsManager({
  actorRole,
  initialBuildings,
}: {
  actorRole: UserRole;
  initialBuildings: BuildingDto[];
}) {
  const { language, t } = useAppSettings();
  const [buildings, setBuildings] = useState(initialBuildings);
  const [editing, setEditing] = useState<BuildingDto | "create" | null>(null);
  const [rooms, setRooms] = useState<Record<string, RoomDto[]>>({});
  const [roomsLoading, setRoomsLoading] = useState<string | null>(null);
  const [roomEditor, setRoomEditor] = useState<{
    building: BuildingDto;
    room: RoomDto | null;
  } | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannedRoom, setScannedRoom] = useState<RoomDto | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const canCreate = hasPermission(actorRole, "inventory.building.create");
  const canEdit = hasPermission(actorRole, "inventory.building.manage");
  const canCreateItem = hasPermission(actorRole, "inventory.item.create");

  function saveBuilding(building: BuildingDto) {
    setBuildings((current) => {
      const existing = current.some((value) => value.id === building.id);
      return existing
        ? current.map((value) => (value.id === building.id ? building : value))
        : [...current, building].sort((left, right) =>
            left.name.localeCompare(right.name),
          );
    });
    setEditing(null);
    setRoomEditor({ building, room: null });
  }

  async function loadRooms(buildingId: string) {
    if (rooms[buildingId] || roomsLoading === buildingId) return;
    setRoomsLoading(buildingId);
    try {
      const response = await fetch(
        `/api/inventory/buildings/${encodeURIComponent(buildingId)}/rooms`,
        { credentials: "same-origin", cache: "no-store" },
      );
      const body = (await response.json().catch(() => null)) as
        | { rooms?: RoomDto[] }
        | null;
      if (response.ok && body?.rooms) {
        setRooms((current) => ({ ...current, [buildingId]: body.rooms! }));
      }
    } finally {
      setRoomsLoading(null);
    }
  }

  function saveRoom(room: RoomDto) {
    setRooms((current) => {
      const currentRooms = current[room.buildingId] ?? [];
      const exists = currentRooms.some((value) => value.id === room.id);
      return {
        ...current,
        [room.buildingId]: exists
          ? currentRooms.map((value) => (value.id === room.id ? room : value))
          : [...currentRooms, room].sort(
              (left, right) =>
                left.floorNumber - right.floorNumber ||
                left.designation.localeCompare(right.designation),
            ),
      };
    });
    setRoomEditor(null);
  }

  async function archiveBuilding(building: BuildingDto) {
    if (!window.confirm(t("building.archiveBuildingConfirm", {
      name: translateCampusBuilding(language, building.name),
    }))) return;
    setArchivingId(building.id);
    setActionError(null);
    try {
      const response = await fetch(`/api/inventory/buildings/${building.id}`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: building.version }),
      });
      if (!response.ok) throw new Error(await readArchiveError(response, t));
      setBuildings((current) => current.filter((value) => value.id !== building.id));
      setRooms((current) => {
        const next = { ...current };
        delete next[building.id];
        return next;
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("building.saveError"));
    } finally {
      setArchivingId(null);
    }
  }

  async function archiveRoom(room: RoomDto) {
    if (!window.confirm(t("building.archiveRoomConfirm", { name: room.designation }))) return;
    setArchivingId(room.id);
    setActionError(null);
    try {
      const response = await fetch(`/api/inventory/rooms/${room.id}`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: room.version }),
      });
      if (!response.ok) throw new Error(await readArchiveError(response, t));
      setRooms((current) => ({
        ...current,
        [room.buildingId]: (current[room.buildingId] ?? []).filter(
          (value) => value.id !== room.id,
        ),
      }));
      setBuildings((current) => current.map((building) =>
        building.id === room.buildingId
          ? { ...building, roomCount: Math.max(0, building.roomCount - 1) }
          : building,
      ));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("building.saveError"));
    } finally {
      setArchivingId(null);
    }
  }

  return (
    <section className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-col gap-4 rounded-2xl border border-black/5 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900">
            {t("inventory.buildingsTitle")}
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            {t("inventory.buildingsSubtitle")}
          </p>
        </div>
        {canCreate ? (
          <button
            type="button"
            onClick={() => setEditing("create")}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-white transition hover:bg-accent-dark"
          >
            <Plus className="h-4 w-4" />
            {t("inventory.addBuilding")}
          </button>
        ) : null}
      </div>
      {actionError ? (
        <p role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {actionError}
        </p>
      ) : null}

      {buildings.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {buildings.map((building) => (
            <article
              key={building.id}
              className="rounded-2xl border border-black/5 bg-white p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-light text-accent-dark">
                    <Building2 className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold text-zinc-900">
                      {translateCampusBuilding(language, building.name)}
                    </h3>
                    <p className="mt-1 flex items-start gap-1.5 text-sm text-zinc-500">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{building.address}</span>
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-black/5 pt-4">
                <button
                  type="button"
                  onClick={() => void loadRooms(building.id)}
                  className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-zinc-200 px-3 text-xs font-semibold text-zinc-600 hover:bg-zinc-50"
                >
                  <DoorOpen className="h-4 w-4" />
                  {roomsLoading === building.id
                    ? "…"
                    : `${t("inventory.roomsCount")}: ${
                        rooms[building.id]?.length ?? building.roomCount
                      }`}
                </button>
                {canCreate ? (
                  <button
                    type="button"
                    onClick={() => {
                      void loadRooms(building.id);
                      setRoomEditor({ building, room: null });
                    }}
                    className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-accent-light px-3 text-xs font-semibold text-accent-dark hover:bg-emerald-100"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t("inventory.addRoom")}
                  </button>
                ) : null}
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => void archiveBuilding(building)}
                    disabled={archivingId === building.id}
                    className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-red-200 px-3 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t("building.archiveBuilding")}
                  </button>
                ) : null}
              </div>

              {rooms[building.id] ? (
                <div className="mt-3 space-y-2">
                  {rooms[building.id].map((room) => (
                    <div
                      key={room.id}
                      className="flex items-center justify-between gap-3 rounded-xl bg-zinc-50 px-3 py-2.5"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <DoorOpen className="h-4 w-4 shrink-0 text-zinc-400" />
                        <span className="truncate text-sm text-zinc-700">
                          {room.designation}
                        </span>
                        <span className="shrink-0 text-xs text-zinc-400">
                          · {room.floorNumber} {t("inventory.floorShort")}
                        </span>
                      </div>
                      <span className="max-w-24 truncate font-mono text-[10px] text-zinc-400 sm:max-w-32">
                        QR: {room.qrCode}
                      </span>
                      {canEdit ? (
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setRoomEditor({ building, room })}
                            className="text-xs font-semibold text-accent-dark hover:underline"
                          >
                            {t("common.open")}
                          </button>
                          <button
                            type="button"
                            onClick={() => void archiveRoom(room)}
                            disabled={archivingId === room.id}
                            aria-label={t("building.archiveRoom", { name: room.designation })}
                            className="rounded-md p-1 text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {!rooms[building.id].length ? (
                    <p className="px-1 text-xs text-zinc-400">
                      {t("inventory.noRooms")}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <dl className="mt-5 grid gap-3 border-t border-black/5 pt-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                    {t("inventory.roomsCount")}
                  </dt>
                  <dd className="mt-1 font-semibold text-zinc-700">
                    {building.roomCount}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-400">
                    <QrCode className="h-3.5 w-3.5" />
                    {t("inventory.qrCode")}
                  </dt>
                  <dd className="mt-1 truncate font-mono text-xs text-zinc-600">
                    {building.qrCode || "—"}
                  </dd>
                </div>
                {findCampusBuildingPreset(building.name) ? (
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                      {t("building.floors")}
                    </dt>
                    <dd className="mt-1 font-semibold text-zinc-700">
                      {findCampusBuildingPreset(building.name)!.floorCount}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-zinc-200 bg-white px-6 py-14 text-center">
          <Building2 className="mx-auto h-10 w-10 text-zinc-300" />
          <p className="mt-3 text-sm text-zinc-500">
            {t("inventory.noBuildings")}
          </p>
        </div>
      )}

      {editing ? (
        <BuildingFormModal
          building={editing === "create" ? null : editing}
          existingBuildingNames={buildings.map((building) => building.name)}
          onClose={() => setEditing(null)}
          onSave={saveBuilding}
        />
      ) : null}
      {roomEditor ? (
        <RoomFormModal
          building={roomEditor.building}
          room={roomEditor.room}
          onClose={() => setRoomEditor(null)}
          onSave={saveRoom}
        />
      ) : null}
      {canCreateItem ? (
        <button
          type="button"
          onClick={() => setScannerOpen(true)}
          className="fixed bottom-6 right-6 z-30 inline-flex min-h-12 items-center gap-2 rounded-full bg-zinc-900 px-5 text-sm font-semibold text-white shadow-xl hover:bg-zinc-700"
        >
          <ScanLine className="h-4 w-4" />
          {t("building.scanRoom")}
        </button>
      ) : null}
      {scannerOpen ? (
        <InventoryRoomQrScanner
          onClose={() => setScannerOpen(false)}
          onRoomResolved={(room) => {
            setScannerOpen(false);
            setScannedRoom({
              id: room.id,
              buildingId: "scanned-room",
              designation: `${room.buildingName} · ${room.designation}`,
              floorNumber: 0,
              floorLabel: null,
              qrCode: "",
              status: "active",
              version: 1,
              createdAt: "",
              updatedAt: "",
            });
          }}
        />
      ) : null}
      {scannedRoom ? (
        <InventoryItemCreateForm
          key={scannedRoom.id}
          rooms={[scannedRoom]}
          initialRoomId={scannedRoom.id}
          openInitially
          hideTrigger
          onCreated={() => setScannedRoom(null)}
          onDismiss={() => setScannedRoom(null)}
        />
      ) : null}
    </section>
  );
}

async function readArchiveError(
  response: Response,
  t: (key: TranslationKey) => string,
): Promise<string> {
  const body = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;
  if (body?.error === "building_has_active_rooms") {
    return t("building.activeRoomsError");
  }
  if (body?.error === "room_has_active_items") {
    return t("building.activeItemsError");
  }
  if (body?.error === "version_conflict") {
    return t("building.conflictError");
  }
  return t("building.saveError");
}

function RoomFormModal({
  building,
  room,
  onClose,
  onSave,
}: {
  building: BuildingDto;
  room: RoomDto | null;
  onClose: () => void;
  onSave: (room: RoomDto) => void;
}) {
  const { t } = useAppSettings();
  const [designation, setDesignation] = useState(room?.designation ?? "");
  const floorCount = findCampusBuildingPreset(building.name)?.floorCount ?? 1;
  const [floorNumber, setFloorNumber] = useState(String(room?.floorNumber ?? 1));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const floor = Number(floorNumber);
    if (
      saving ||
      !designation.trim() ||
      !Number.isInteger(floor) ||
      floor < 1 ||
      floor > floorCount
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        room
          ? `/api/inventory/rooms/${encodeURIComponent(room.id)}`
          : `/api/inventory/buildings/${encodeURIComponent(building.id)}/rooms`,
        {
          method: room ? "PATCH" : "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            designation: designation.trim(),
            floorNumber: floor,
            floorLabel: null,
            ...(room ? { version: room.version } : {}),
          }),
        },
      );
      const body: unknown = await response.json().catch(() => null);
      if (
        !response.ok ||
        !body ||
        typeof body !== "object" ||
        !("room" in body)
      ) {
        setError(t("inventory.saveFailed"));
        return;
      }
      onSave((body as { room: RoomDto }).room);
    } catch {
      setError(t("inventory.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="room-form-title"
    >
      <form
        onSubmit={submit}
        className="w-full rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-3xl sm:p-6"
      >
        <div className="flex items-center justify-between">
          <h2 id="room-form-title" className="text-lg font-semibold text-zinc-900">
            {room ? t("inventory.editRoom") : t("inventory.createRoom")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label={t("common.close")}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-zinc-700">
            {t("inventory.roomDesignation")}
            <input
              value={designation}
              onChange={(event) => setDesignation(event.target.value)}
              maxLength={80}
              required
              className={INPUT_CLASS}
            />
          </label>
          <label className="text-sm font-medium text-zinc-700">
            {t("inventory.floor")}
            <select
              value={floorNumber}
              onChange={(event) => setFloorNumber(event.target.value)}
              required
              className={INPUT_CLASS}
            >
              {Array.from({ length: floorCount }, (_, index) => index + 1).map(
                (floor) => (
                  <option key={floor} value={floor}>
                    {floor} {t("inventory.floorShort")}
                  </option>
                ),
              )}
            </select>
          </label>
        </div>
        {error ? (
          <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="min-h-11 rounded-xl border border-zinc-200 px-4 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={saving || !designation.trim()}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            {saving ? t("inventory.saving") : t("common.save")}
          </button>
        </div>
      </form>
    </div>
  );
}

function BuildingFormModal({
  building,
  existingBuildingNames,
  onClose,
  onSave,
}: {
  building: BuildingDto | null;
  existingBuildingNames: string[];
  onClose: () => void;
  onSave: (building: BuildingDto) => void;
}) {
  const { language, t } = useAppSettings();
  const [presetId, setPresetId] = useState(
    findCampusBuildingPreset(building?.name ?? "")?.id ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedPreset = CAMPUS_INVENTORY_BUILDING_PRESETS.find(
    (preset) => preset.id === presetId,
  );
  const existingNames = new Set(existingBuildingNames);
  const existingPresetIds = new Set(
    existingBuildingNames
      .map((name) => findCampusBuildingPreset(name)?.id)
      .filter((id): id is string => Boolean(id)),
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !selectedPreset) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        building
          ? `/api/inventory/buildings/${encodeURIComponent(building.id)}`
          : "/api/inventory/buildings",
        {
          method: building ? "PATCH" : "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: selectedPreset.name,
            address: selectedPreset.address,
            ...(building ? { version: building.version } : {}),
          }),
        },
      );
      const body: unknown = await response.json().catch(() => null);
      if (
        !response.ok ||
        !body ||
        typeof body !== "object" ||
        !("building" in body)
      ) {
        setError(t("inventory.saveFailed"));
        return;
      }
      onSave((body as { building: BuildingDto }).building);
    } catch {
      setError(t("inventory.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="building-form-title"
    >
      <form
        onSubmit={submit}
        className="w-full rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-3xl sm:p-6"
      >
        <div className="flex items-center justify-between">
          <h2
            id="building-form-title"
            className="text-lg font-semibold text-zinc-900"
          >
            {t(
              building
                ? "inventory.editBuilding"
                : "inventory.createBuilding",
            )}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label={t("common.close")}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <label className="block text-sm font-medium text-zinc-700">
            {t("building.select")}
            <select
              value={presetId}
              onChange={(event) => setPresetId(event.target.value)}
              required
              autoFocus
              className={INPUT_CLASS}
              disabled={Boolean(building)}
            >
              <option value="">{t("building.selectFromList")}</option>
              {CAMPUS_INVENTORY_BUILDING_PRESETS.map((preset) => (
                <option
                  key={preset.id}
                  value={preset.id}
                  disabled={
                    !building &&
                    (existingNames.has(preset.name) ||
                      existingPresetIds.has(preset.id))
                  }
                >
                  {t("building.presetSummary", {
                    name: translateCampusBuilding(language, preset.name),
                    address: preset.address,
                    count: preset.floorCount,
                  })}
                </option>
              ))}
            </select>
          </label>
          {selectedPreset ? (
            <dl className="rounded-2xl bg-emerald-50 p-4 text-sm text-zinc-700">
              <div className="flex justify-between gap-4"><dt className="text-zinc-500">{t("inventory.buildingName")}</dt><dd className="text-right font-semibold">{translateCampusBuilding(language, selectedPreset.name)}</dd></div>
              <div className="mt-2 flex justify-between gap-4"><dt className="text-zinc-500">{t("inventory.buildingAddress")}</dt><dd className="text-right font-semibold">{selectedPreset.address}</dd></div>
              <div className="mt-2 flex justify-between gap-4"><dt className="text-zinc-500">{t("building.floors")}</dt><dd className="font-semibold">{selectedPreset.floorCount}</dd></div>
            </dl>
          ) : null}
        </div>

        {error ? (
          <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="min-h-11 rounded-xl border border-zinc-200 px-4 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={saving || !selectedPreset}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            {saving ? t("inventory.saving") : t("common.save")}
          </button>
        </div>
      </form>
    </div>
  );
}

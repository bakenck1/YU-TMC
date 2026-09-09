"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  Barcode,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  Pencil,
  Plus,
  QrCode,
  Save,
  ShieldCheck,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type {
  InventoryItemCommentDto,
  InventoryItemDto,
  InventoryItemOperationDto,
} from "@/lib/contracts/inventory-items";
import type { RoomDto } from "@/lib/contracts/inventory-locations";
import { useAppSettings } from "@/components/AppSettingsProvider";
import InventoryItemQrDialogs from "@/components/InventoryItemQrDialogs";
import InventoryItemArchiveDialog from "@/components/InventoryItemArchiveDialog";
import InventoryItemServiceDialog from "@/components/InventoryItemServiceDialog";
import InventoryItemCameraCapture from "@/components/InventoryItemCameraCapture";
import InventoryItemComposition from "@/components/InventoryItemComposition";
import InventoryItemComments from "@/components/InventoryItemComments";
import InventoryOverviewRow from "@/components/InventoryOverviewRow";
import LocalBarcodeDistributionPanel from "@/components/LocalBarcodeDistributionPanel";
import {
  localizeItemError,
  operationDetail,
  operationTitle,
  responseErrorCode,
} from "@/components/InventoryItemDetailsPresentation";
import { translateCampusBuilding } from "@/lib/i18n";
import type { UserRole } from "@/lib/contracts/users";
import type { LocalBarcodeGroupDto } from "@/lib/contracts/local-barcodes";
import TmcUserPicker from "@/components/TmcUserPicker";
import type { TmcOperationUserDto } from "@/lib/contracts/tmc-operations";
import {
  categoryFromLegacyType,
  inventoryItemCategoryTranslationKey,
  type InventoryItemCategory,
} from "@/lib/inventory-categories";
import { addItemPhotoWithRefresh } from "@/lib/inventory-item-photo-client";

type ResponsiblePickerValue = Pick<TmcOperationUserDto, "id" | "fullName"> &
  Partial<Pick<TmcOperationUserDto, "email" | "role">>;

function responsiblePickerValue(
  responsible: InventoryItemDto["responsible"],
): ResponsiblePickerValue | null {
  return responsible
    ? { id: responsible.id, fullName: responsible.name }
    : null;
}

export default function InventoryItemDetails({
  initialItem,
  canEditContent,
  canSendToService,
  requiresServicePhoto,
  canManageCode,
  operations,
  initialComments,
  canComment,
  canManageProtected,
  rooms,
  initialComponents,
  localGroups,
  canManageComponents,
  actorId,
  actorRole,
  localBarcodeInfo,
  localBarcodeItemId,
  hideComposition = false,
  commentItemId,
}: {
  initialItem: InventoryItemDto;
  canEditContent: boolean;
  canSendToService: boolean;
  requiresServicePhoto: boolean;
  canManageCode: boolean;
  operations: InventoryItemOperationDto[];
  initialComments: InventoryItemCommentDto[];
  canComment: boolean;
  canManageProtected: boolean;
  rooms: Array<RoomDto & { buildingName: string }>;
  initialComponents: InventoryItemDto[];
  localGroups?: LocalBarcodeGroupDto[];
  canManageComponents: boolean;
  actorId: string;
  actorRole: UserRole;
  localBarcodeInfo?: { originalBarcode: string; transferredAt: string };
  /** Source item used for the local-barcode distribution panel. */
  localBarcodeItemId?: string;
  hideComposition?: boolean;
  /** Local groups share the source item's comment thread. */
  commentItemId?: string;
}) {
  const { language, locale, t } = useAppSettings();
  const router = useRouter();
  const [item, setItem] = useState(initialItem);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [description, setDescription] = useState(item.description ?? "");
  const [category, setCategory] = useState<InventoryItemCategory>(
    item.category ?? categoryFromLegacyType(item.itemType),
  );
  const [brand, setBrand] = useState(item.brand ?? "");
  const [model, setModel] = useState(item.model ?? "");
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [unitPrice, setUnitPrice] = useState(String(item.unitPrice));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [protectedEditing, setProtectedEditing] = useState(false);
  const [protectedBuildingId, setProtectedBuildingId] = useState(item.room.buildingId);
  const [protectedRoomId, setProtectedRoomId] = useState(item.room.id);
  const [responsible, setResponsible] = useState<ResponsiblePickerValue | null>(
    responsiblePickerValue(item.responsible),
  );
  const [inventoryNumber, setInventoryNumber] = useState(item.inventoryNumber);
  const [status, setStatus] = useState(item.status);
  const [condition, setCondition] = useState<NonNullable<InventoryItemDto["condition"]>>(item.condition ?? "good");
  const [connectionStatus, setConnectionStatus] = useState<NonNullable<InventoryItemDto["connectionStatus"]>>(item.connectionStatus ?? "not_applicable");
  const [replaceQr, setReplaceQr] = useState(false);
  const [qrReplaceReason, setQrReplaceReason] = useState("");
  const [archiving, setArchiving] = useState(false);
  const [servicing, setServicing] = useState(false);
  const [archiveConfirmationOpen, setArchiveConfirmationOpen] = useState(false);
  const [serviceDialogOpen, setServiceDialogOpen] = useState(false);
  const [servicePhoto, setServicePhoto] = useState<{ imageDataUrl: string; width: number; height: number } | null>(null);
  const [decommissionedUsageReason, setDecommissionedUsageReason] = useState("");
  const [decommissionedUsageComment, setDecommissionedUsageComment] = useState("");
  const [decommissionedUsagePhoto, setDecommissionedUsagePhoto] = useState<{ imageDataUrl: string; width: number; height: number } | null>(null);
  const [restoreReason, setRestoreReason] = useState("");
  const [cameraTarget, setCameraTarget] = useState<"item" | "service" | "decommissioned_usage">("item");
  const [qrDialog, setQrDialog] = useState<"generate" | "scan" | "purpose" | null>(null);
  const [codeKind, setCodeKind] = useState<"barcode" | "qr">("barcode");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [capturingPhoto, setCapturingPhoto] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const editDialogRef = useRef<HTMLDivElement>(null);
  const editTriggerRef = useRef<HTMLButtonElement>(null);
  const protectedDialogRef = useRef<HTMLDivElement>(null);
  const protectedTriggerRef = useRef<HTMLButtonElement>(null);
  const photoDialogRef = useRef<HTMLDivElement>(null);
  const photoTriggerRef = useRef<HTMLButtonElement>(null);
  const photoCloseButtonRef = useRef<HTMLButtonElement>(null);
  const protectedBuildings = Array.from(
    new Map(
      rooms.map((room) => [
        room.buildingId,
        { id: room.buildingId, name: room.buildingName },
      ]),
    ).values(),
  );
  const protectedBuildingRooms = rooms.filter(
    (room) => room.buildingId === protectedBuildingId,
  );
  const itemPhotoUrls = item.photoUrls?.length
    ? item.photoUrls
    : item.photoUrl ? [item.photoUrl] : [];
  const selectedPhotoUrl = itemPhotoUrls[Math.min(selectedPhotoIndex, itemPhotoUrls.length - 1)];

  useEffect(() => {
    if (!editing) return;
    const previousOverflow = document.body.style.overflow;
    const previousActiveElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const editTrigger = editTriggerRef.current;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() =>
      editDialogRef.current?.querySelector<HTMLInputElement>("input")?.focus(),
    );
    return () => {
      document.body.style.overflow = previousOverflow;
      (previousActiveElement ?? editTrigger)?.focus();
    };
  }, [editing]);

  useEffect(() => {
    if (!protectedEditing) return;
    const previousOverflow = document.body.style.overflow;
    const previousActiveElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const protectedTrigger = protectedTriggerRef.current;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() =>
      protectedDialogRef.current?.querySelector<HTMLSelectElement>("select")?.focus(),
    );
    return () => {
      document.body.style.overflow = previousOverflow;
      (previousActiveElement ?? protectedTrigger)?.focus();
    };
  }, [protectedEditing]);

  useEffect(() => {
    if (!photoOpen) return;
    const previousOverflow = document.body.style.overflow;
    const previousActiveElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const photoTrigger = photoTriggerRef.current;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => photoCloseButtonRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPhotoOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        photoDialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled])",
        ) ?? [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      (previousActiveElement ?? photoTrigger)?.focus();
    };
  }, [photoOpen]);

  function openContentEditor() {
    setName(item.name);
    setDescription(item.description ?? "");
    setCategory(item.category ?? categoryFromLegacyType(item.itemType));
    setBrand(item.brand ?? "");
    setModel(item.model ?? "");
    setQuantity(String(item.quantity));
    setUnitPrice(String(item.unitPrice));
    setError("");
    setSaved(false);
    setEditing(true);
  }

  function closeContentEditor() {
    if (saving) return;
    setEditing(false);
    setName(item.name);
    setDescription(item.description ?? "");
    setCategory(item.category ?? categoryFromLegacyType(item.itemType));
    setBrand(item.brand ?? "");
    setModel(item.model ?? "");
    setQuantity(String(item.quantity));
    setUnitPrice(String(item.unitPrice));
    setError("");
  }

  function handleEditDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeContentEditor();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      editDialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), textarea:not([disabled])",
      ) ?? [],
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function saveContent() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const response = await fetch(`/api/inventory/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: item.version,
          name,
          description: description || null,
          category,
          brand: brand || null,
          model: model || null,
          quantity: Number(quantity),
          unitPrice: Number(unitPrice),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        item?: InventoryItemDto;
        error?: string;
      };
      if (!response.ok || !body.item) {
        throw new Error(body.error ?? responseErrorCode(response.status));
      }
      setItem(body.item);
      setCategory(body.item.category ?? categoryFromLegacyType(body.item.itemType));
      setBrand(body.item.brand ?? "");
      setModel(body.item.model ?? "");
      setQuantity(String(body.item.quantity));
      setUnitPrice(String(body.item.unitPrice));
      setEditing(false);
      setSaved(true);
      router.refresh();
    } catch (cause) {
      setError(localizeItemError(cause, t));
    } finally {
      setSaving(false);
    }
  }

  function printCodeLabel(kind: "barcode" | "qr") {
    window.open(`/items/${item.id}/qr?kind=${kind}`, "_blank", "noopener,noreferrer");
    setQrDialog(null);
  }

  async function saveProtectedFields() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      if (item.status !== "decommissioned_in_use" && status === "decommissioned_in_use") {
        const response = await fetch(`/api/inventory/items/${item.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            operation: "mark_decommissioned_in_use",
            version: item.version,
            roomId: protectedRoomId,
            responsibleUserId: responsible?.id ?? null,
            reason: decommissionedUsageReason,
            adminComment: decommissionedUsageComment,
            photo: decommissionedUsagePhoto,
          }),
        });
        const body = await response.json().catch(() => ({})) as { item?: InventoryItemDto; error?: string };
        if (!response.ok || !body.item) throw new Error(body.error ?? responseErrorCode(response.status));
        setItem(body.item);
        setStatus(body.item.status);
        setResponsible(responsiblePickerValue(body.item.responsible));
        setProtectedEditing(false);
        setSaved(true);
        router.refresh();
        return;
      }
      if (
        (item.status === "decommissioned" || item.status === "decommissioned_in_use") &&
        status === "active"
      ) {
        const response = await fetch(`/api/inventory/items/${item.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            operation: "restore_decommissioned",
            version: item.version,
            reason: restoreReason,
          }),
        });
        const body = await response.json().catch(() => ({})) as { item?: InventoryItemDto; error?: string };
        if (!response.ok || !body.item) throw new Error(body.error ?? responseErrorCode(response.status));
        setItem(body.item);
        setStatus(body.item.status);
        setProtectedEditing(false);
        setSaved(true);
        router.refresh();
        return;
      }
      const roomChanged = protectedRoomId !== item.room.id;
      const inventoryNumberChanged = inventoryNumber.trim() !== item.inventoryNumber;
      const statusChanged = status !== item.status;
      const responsibleChanged =
        (responsible?.id ?? null) !== (item.responsible?.id ?? null);
      const submit = async (
        version: number,
        values: { roomId: string; inventoryNumber: string; status: InventoryItemDto["status"]; condition: NonNullable<InventoryItemDto["condition"]>; connectionStatus: NonNullable<InventoryItemDto["connectionStatus"]>; responsibleUserId: string | null },
      ) => {
        const response = await fetch(`/api/inventory/items/${item.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            version,
            ...values,
            replaceQr,
            qrReplaceReason: replaceQr ? qrReplaceReason : null,
          }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          item?: InventoryItemDto;
          error?: string;
        };
        return { response, body };
      };
      let result = await submit(item.version, {
        roomId: protectedRoomId,
        inventoryNumber,
        status,
        condition,
        connectionStatus,
        responsibleUserId: responsible?.id ?? null,
      });
      if (result.response.status === 409 && result.body.error === "version_conflict") {
        const latestResponse = await fetch(`/api/inventory/items/${item.id}`);
        const latestBody = (await latestResponse.json().catch(() => ({}))) as {
          item?: InventoryItemDto;
          error?: string;
        };
        if (!latestResponse.ok || !latestBody.item) {
          throw new Error(latestBody.error ?? responseErrorCode(latestResponse.status));
        }
        const latestItem = latestBody.item;
        setItem(latestItem);
        result = await submit(latestItem.version, {
          roomId: roomChanged ? protectedRoomId : latestItem.room.id,
          inventoryNumber: inventoryNumberChanged
            ? inventoryNumber
            : latestItem.inventoryNumber,
          status: statusChanged ? status : latestItem.status,
          condition: condition !== (item.condition ?? "good") ? condition : (latestItem.condition ?? "good"),
          connectionStatus: connectionStatus !== (item.connectionStatus ?? "not_applicable") ? connectionStatus : (latestItem.connectionStatus ?? "not_applicable"),
          responsibleUserId: responsibleChanged
            ? responsible?.id ?? null
            : latestItem.responsible?.id ?? null,
        });
      }
      if (!result.response.ok || !result.body.item) {
        throw new Error(result.body.error ?? responseErrorCode(result.response.status));
      }
      const body = result.body as { item: InventoryItemDto };
      setItem(body.item);
      setProtectedBuildingId(body.item.room.buildingId);
      setProtectedRoomId(body.item.room.id);
      setInventoryNumber(body.item.inventoryNumber);
      setStatus(body.item.status);
      setCondition(body.item.condition ?? "good");
      setConnectionStatus(body.item.connectionStatus ?? "not_applicable");
      setResponsible(responsiblePickerValue(body.item.responsible));
      setProtectedEditing(false);
      setReplaceQr(false);
      setQrReplaceReason("");
      setSaved(true);
      router.refresh();
    } catch (cause) {
      setError(localizeItemError(cause, t));
    } finally {
      setSaving(false);
    }
  }

  function openProtectedFields() {
    setProtectedBuildingId(item.room.buildingId);
    setProtectedRoomId(item.room.id);
    setInventoryNumber(item.inventoryNumber);
    setStatus(item.status);
    setCondition(item.condition ?? "good");
    setConnectionStatus(item.connectionStatus ?? "not_applicable");
    setResponsible(responsiblePickerValue(item.responsible));
    setReplaceQr(false);
    setQrReplaceReason("");
    setDecommissionedUsageReason("");
    setDecommissionedUsageComment("");
    setDecommissionedUsagePhoto(null);
    setRestoreReason("");
    setError("");
    setSaved(false);
    setProtectedEditing(true);
  }

  function closeProtectedFields() {
    if (saving) return;
    setProtectedBuildingId(item.room.buildingId);
    setProtectedRoomId(item.room.id);
    setInventoryNumber(item.inventoryNumber);
    setStatus(item.status);
    setCondition(item.condition ?? "good");
    setConnectionStatus(item.connectionStatus ?? "not_applicable");
    setResponsible(responsiblePickerValue(item.responsible));
    setReplaceQr(false);
    setQrReplaceReason("");
    setError("");
    setProtectedEditing(false);
  }

  function handleProtectedDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeProtectedFields();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      protectedDialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled])",
      ) ?? [],
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function archiveItem() {
    setArchiving(true);
    setError("");
    try {
      const response = await fetch(`/api/inventory/items/${item.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: item.version }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? responseErrorCode(response.status));
      }
      router.push("/items");
      router.refresh();
    } catch (cause) {
      setError(localizeItemError(cause, t));
      setArchiving(false);
    }
  }

  async function sendToService(input: { serviceName: string; reason: string }) {
    setServicing(true);
    setError("");
    setSaved(false);
    try {
      const response = await fetch(`/api/inventory/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "send_to_service",
          version: item.version,
          serviceName: input.serviceName,
          reason: input.reason,
          ...(servicePhoto ? { photo: servicePhoto } : {}),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        item?: InventoryItemDto;
        error?: string;
      };
      if (!response.ok || !body.item) {
        throw new Error(body.error ?? responseErrorCode(response.status));
      }
      setItem(body.item);
      setServiceDialogOpen(false);
      setServicePhoto(null);
      setSaved(true);
      router.refresh();
    } catch (cause) {
      setError(localizeItemError(cause, t));
    } finally {
      setServicing(false);
    }
  }

  async function saveCameraPhoto(photo: {
    imageDataUrl: string;
    width: number;
    height: number;
  }) {
    if (itemPhotoUrls.length >= 4) return;
    setCapturingPhoto(true);
    setError("");
    setSaved(false);
    try {
      const updatedItem = await addItemPhotoWithRefresh(fetch, item, photo);
      setItem(updatedItem);
      setSelectedPhotoIndex(Math.max(0, (updatedItem.photoUrls?.length ?? 1) - 1));
      setPhotoOpen(true);
      setSaved(true);
      router.refresh();
    } catch (cause) {
      setError(localizeItemError(cause, t));
    } finally {
      setCapturingPhoto(false);
    }
  }

  async function deletePhoto(photoUrl = selectedPhotoUrl) {
    if (!photoUrl || !window.confirm(t("item.deletePhotoConfirm"))) return;
    setCapturingPhoto(true);
    setError("");
    try {
      const response = await fetch(`/api/inventory/items/${item.id}/photo`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: item.version, photoId: photoIdFromUrl(photoUrl) }),
      });
      const body = await response.json().catch(() => ({})) as { item?: InventoryItemDto; error?: string };
      if (!response.ok || !body.item) throw new Error(body.error ?? responseErrorCode(response.status));
      setItem(body.item);
      if ((body.item.photoUrls?.length ?? (body.item.photoUrl ? 1 : 0)) === 0) setPhotoOpen(false);
      setSelectedPhotoIndex((current) => Math.max(0, Math.min(current, (body.item?.photoUrls?.length ?? 1) - 1)));
      setSaved(true);
      router.refresh();
    } catch (cause) {
      setError(localizeItemError(cause, t));
    } finally {
      setCapturingPhoto(false);
    }
  }

  const statusLabel =
    item.status === "maintenance"
      ? t("itemDetails.statusMaintenance")
      : item.status === "decommissioned"
        ? t("itemDetails.statusDecommissioned")
        : item.status === "decommissioned_in_use"
          ? t("itemDetails.statusDecommissionedInUse")
          : t("itemDetails.statusActive");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-zinc-700">{item.name}</h1>
        <span className={`rounded px-2 py-1 text-xs font-medium ${item.status === "decommissioned_in_use" ? "bg-orange-100 text-orange-800 ring-1 ring-orange-300" : "bg-violet-100 text-violet-600"}`}>
          {statusLabel}
        </span>
      </div>

      <nav
        aria-label={t("itemDetails.actions")}
        className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-black/5 bg-white/95 p-2 shadow-md backdrop-blur"
      >
        <div className="flex flex-wrap gap-2">
          <span
            aria-current="page"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <FileText className="h-4 w-4" /> {t("items.information")}
          </span>
          {canEditContent ? <button ref={editTriggerRef} type="button" onClick={openContentEditor} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"><Pencil className="h-4 w-4" />{t("items.edit")}</button> : null}
          {canManageCode ? <button type="button" onClick={() => { setCodeKind("barcode"); setQrDialog("generate"); }} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"><Barcode className="h-4 w-4" />{t("itemDetails.barcode")}</button> : null}
        </div>
        {canSendToService || canManageProtected ? (
          <div className="ml-auto flex flex-wrap justify-end gap-2">
            {canManageProtected ? (
              <button
                ref={protectedTriggerRef}
                type="button"
                onClick={openProtectedFields}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
              >
                <ShieldCheck className="h-4 w-4" />
                {t("itemDetails.protectedFields")}
              </button>
            ) : null}
            {canSendToService ? <button type="button" onClick={() => setServiceDialogOpen(true)} disabled={servicing || item.status !== "active"} title={item.status === "maintenance" ? t("itemDetails.alreadyInService") : t("items.sendToService")} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"><Wrench className="h-4 w-4" />{servicing ? t("itemDetails.sending") : item.status === "maintenance" ? t("itemDetails.inService") : t("items.sendToService")}</button> : null}
            {canManageProtected ? <button type="button" onClick={() => setArchiveConfirmationOpen(true)} disabled={archiving || item.status === "decommissioned" || item.status === "decommissioned_in_use"} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50"><Trash2 className="h-4 w-4" />{t("items.writeOff")}</button> : null}
          </div>
        ) : null}
      </nav>

      {canManageProtected && protectedEditing ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeProtectedFields();
          }}
        >
        <section
          ref={protectedDialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="protected-fields-title"
          aria-describedby="protected-fields-description"
          onKeyDown={handleProtectedDialogKeyDown}
          className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-2xl"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="protected-fields-title" className="text-lg font-semibold text-zinc-800">
                {t("itemDetails.protectedFields")}
              </h2>
              <p id="protected-fields-description" className="mt-1 text-sm text-zinc-500">
                {t("itemDetails.protectedHint")}
              </p>
            </div>
            <button
              type="button"
              onClick={closeProtectedFields}
              disabled={saving}
              aria-label={t("common.close")}
              className="rounded-lg p-2 text-zinc-500 transition hover:bg-amber-100 disabled:opacity-50"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-zinc-600">{t("analytics.buildingFilter")}</span>
              <select
                value={protectedBuildingId}
                onChange={(event) => {
                  const buildingId = event.target.value;
                  setProtectedBuildingId(buildingId);
                  setProtectedRoomId(
                    rooms.find((room) => room.buildingId === buildingId)?.id ?? "",
                  );
                }}
                className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5"
              >
                {protectedBuildings.map((building) => (
                  <option key={building.id} value={building.id}>
                    {translateCampusBuilding(language, building.name)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-zinc-600">{t("item.condition")}</span>
              <select value={condition} onChange={(event) => setCondition(event.target.value as NonNullable<InventoryItemDto["condition"]>)} className="mt-1 min-h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-base">
                <option value="good">{t("condition.good")}</option>
                <option value="needs_attention">{t("condition.needs_attention")}</option>
                <option value="damaged">{t("condition.damaged")}</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-zinc-600">{t("room.connected")}</span>
              <select value={connectionStatus} onChange={(event) => setConnectionStatus(event.target.value as NonNullable<InventoryItemDto["connectionStatus"]>)} className="mt-1 min-h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-base">
                <option value="connected">{t("connection.connected")}</option>
                <option value="disconnected">{t("connection.disconnected")}</option>
                <option value="not_applicable">{t("connection.not_applicable")}</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-zinc-600">{t("itemDetails.room")}</span>
              <select
                value={protectedRoomId}
                onChange={(event) => setProtectedRoomId(event.target.value)}
                className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5"
              >
                {protectedBuildingRooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.designation} · {t("inventory.floorShort")} {room.floorNumber}
                  </option>
                ))}
              </select>
            </label>
            <div className="sm:col-span-2">
              <TmcUserPicker
                value={responsible}
                onChange={setResponsible}
                employeeOnly
                label={`${t("createItem.responsible")} (${t("createItem.optional")})`}
              />
            </div>
            <label className="block text-sm">
              <span className="text-zinc-600">{t("itemDetails.officialNumber")}</span>
              <input
                value={inventoryNumber}
                onChange={(event) => setInventoryNumber(event.target.value)}
                maxLength={64}
                aria-describedby="official-number-hint"
                className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5"
              />
              <span id="official-number-hint" className="mt-1 block text-xs text-zinc-500">
                {t("itemDetails.officialNumberHint")}
              </span>
            </label>
            <label className="block text-sm">
              <span className="text-zinc-600">{t("items.status")}</span>
              <select
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as InventoryItemDto["status"])
                }
                className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5"
              >
                {(item.status === "decommissioned" || item.status === "decommissioned_in_use") ? (
                  <>
                    {item.status === "decommissioned" ? <option value="decommissioned">{t("itemDetails.statusDecommissioned")}</option> : null}
                    <option value="decommissioned_in_use">{t("itemDetails.statusDecommissionedInUse")}</option>
                    <option value="active">{t("itemDetails.restoreFromDecommission")}</option>
                  </>
                ) : (
                  <>
                    <option value="active">{t("itemDetails.statusActive")}</option>
                    <option value="maintenance">{t("itemDetails.statusMaintenance")}</option>
                    <option value="decommissioned">{t("itemDetails.statusDecommissioned")}</option>
                    <option value="decommissioned_in_use">{t("itemDetails.statusDecommissionedInUse")}</option>
                  </>
                )}
              </select>
            </label>
            {item.status !== "decommissioned_in_use" && status === "decommissioned_in_use" ? (
              <div className="space-y-3 rounded-xl border border-orange-200 bg-orange-50 p-4 sm:col-span-2">
                <p className="font-semibold text-orange-900">{t("itemDetails.decommissionedUsageTitle")}</p>
                <label className="block text-sm text-zinc-700">
                  {t("itemDetails.decommissionedUsageReason")}
                  <textarea value={decommissionedUsageReason} onChange={(event) => setDecommissionedUsageReason(event.target.value)} maxLength={1000} rows={2} className="mt-1 w-full rounded-xl border border-orange-200 bg-white px-3 py-2.5" />
                </label>
                <label className="block text-sm text-zinc-700">
                  {t("itemDetails.decommissionedUsageComment")}
                  <textarea value={decommissionedUsageComment} onChange={(event) => setDecommissionedUsageComment(event.target.value)} maxLength={2000} rows={2} className="mt-1 w-full rounded-xl border border-orange-200 bg-white px-3 py-2.5" />
                </label>
                <button type="button" onClick={() => { setCameraTarget("decommissioned_usage"); setCameraOpen(true); }} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-orange-300 bg-white px-4 text-sm font-semibold text-orange-800">
                  <Camera className="h-4 w-4" />
                  {decommissionedUsagePhoto ? t("itemDetails.conditionPhotoAttached") : t("itemDetails.addConditionPhoto")}
                </button>
              </div>
            ) : null}
            {(item.status === "decommissioned" || item.status === "decommissioned_in_use") && status === "active" ? (
              <label className="block text-sm text-zinc-700 sm:col-span-2">
                {t("itemDetails.restoreReason")}
                <textarea value={restoreReason} onChange={(event) => setRestoreReason(event.target.value)} maxLength={1000} rows={2} className="mt-1 w-full rounded-xl border border-emerald-200 bg-white px-3 py-2.5" />
              </label>
            ) : null}
            <div className="space-y-2 text-sm sm:col-span-2">
              <label className="flex items-center gap-2 text-zinc-700">
                <input
                  type="checkbox"
                  checked={replaceQr}
                  onChange={(event) => setReplaceQr(event.target.checked)}
                />
                {t("itemDetails.replaceCode")}
              </label>
              {replaceQr ? (
                <input
                  value={qrReplaceReason}
                  onChange={(event) => setQrReplaceReason(event.target.value)}
                  placeholder={t("itemDetails.replaceReason")}
                  maxLength={1000}
                  className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5"
                />
              ) : null}
            </div>
            {error ? (
              <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 sm:col-span-2">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2 border-t border-amber-200 pt-4 sm:col-span-2">
              <button
                type="button"
                onClick={closeProtectedFields}
                disabled={saving}
                className="rounded-lg border border-black/10 bg-white px-4 py-2 text-sm text-zinc-600 disabled:opacity-50"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void saveProtectedFields()}
                disabled={
                  saving ||
                  !protectedRoomId ||
                  !inventoryNumber.trim() ||
                  ((item.status === "decommissioned" || item.status === "decommissioned_in_use") && status === "active" && !restoreReason.trim()) ||
                  (replaceQr && !qrReplaceReason.trim())
                }
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? t("itemDetails.saving") : t("common.save")}
              </button>
            </div>
          </div>
        </section>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <Check className="h-4 w-4" /> {t("itemDetails.saved")}
        </p>
      ) : null}
      <InventoryItemQrDialogs
        kind={qrDialog}
        codeKind={codeKind}
        onCodeKindChange={setCodeKind}
        onClose={() => setQrDialog(null)}
        onPrint={printCodeLabel}
      />
      <InventoryItemArchiveDialog
        itemName={item.name}
        open={archiveConfirmationOpen}
        saving={archiving}
        onClose={() => setArchiveConfirmationOpen(false)}
        onConfirm={() => void archiveItem()}
      />
      <InventoryItemServiceDialog
        open={serviceDialogOpen}
        saving={servicing}
        onClose={() => { setServiceDialogOpen(false); setServicePhoto(null); }}
        onSubmit={(input) => void sendToService(input)}
        onAddPhoto={() => { setCameraTarget("service"); setCameraOpen(true); }}
        photoAttached={Boolean(servicePhoto)}
        photoRequired={requiresServicePhoto}
      />
      <InventoryItemCameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(photo) => {
          setCameraOpen(false);
          if (cameraTarget === "service") setServicePhoto(photo);
          else if (cameraTarget === "decommissioned_usage") setDecommissionedUsagePhoto(photo);
          else void saveCameraPhoto(photo);
        }}
      />
      {editing ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeContentEditor();
          }}
        >
          <div
            ref={editDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="item-editor-title"
            aria-describedby="item-editor-description"
            onKeyDown={handleEditDialogKeyDown}
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="item-editor-title" className="text-lg font-semibold text-zinc-800">
                  {t("itemDetails.card")}
                </h2>
                <p id="item-editor-description" className="mt-1 text-sm text-zinc-500">
                  {t("itemDetails.currentRegistryData")}
                </p>
              </div>
              <button
                type="button"
                onClick={closeContentEditor}
                disabled={saving}
                aria-label={t("common.close")}
                className="rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              className="mt-6 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void saveContent();
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="text-zinc-500">{t("items.name")}</span>
                  <input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" />
                </label>
                <label className="block text-sm">
                  <span className="text-zinc-500">{t("items.type")}</span>
                  <select value={category} onChange={(event) => setCategory(event.target.value as typeof category)} className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 outline-none focus:border-emerald-500"><option value="electronics">{t("common.electronics")}</option><option value="electrical_equipment">{t("data.electricalEquipment")}</option><option value="furniture">{t("data.furniture")}</option></select>
                </label>
                <label className="block text-sm">
                  <span className="text-zinc-500">{t("itemDetails.brand")}</span>
                  <input value={brand} onChange={(event) => setBrand(event.target.value)} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" />
                </label>
                <label className="block text-sm">
                  <span className="text-zinc-500">{t("itemDetails.model")}</span>
                  <input value={model} onChange={(event) => setModel(event.target.value)} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" />
                </label>
                <label className="block text-sm">
                  <span className="text-zinc-500">{t("items.quantity")}</span>
                  <input type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" />
                </label>
                <label className="block text-sm">
                  <span className="text-zinc-500">{t("itemDetails.unitPriceCurrency")}</span>
                  <input type="number" min="0" step="0.01" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" />
                </label>
              </div>
              <label className="block text-sm">
                <span className="text-zinc-500">{t("itemDetails.description")}</span>
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} className="mt-1 w-full resize-none rounded-xl border border-black/10 px-3 py-2.5 outline-none focus:border-emerald-500" />
              </label>
              {error ? (
                <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </p>
              ) : null}
              <div className="flex justify-end gap-2 border-t border-black/5 pt-4">
                <button type="button" onClick={closeContentEditor} disabled={saving} className="rounded-lg border border-black/10 px-4 py-2 text-sm text-zinc-600 disabled:opacity-50">
                  {t("common.cancel")}
                </button>
                <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  <Save className="h-4 w-4" /> {saving ? t("itemDetails.saving") : t("common.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      {photoOpen && selectedPhotoUrl ? (
        <div
          ref={photoDialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={t("itemDetails.photoFullSize")}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4"
          onClick={() => setPhotoOpen(false)}
        >
          <button
            ref={photoCloseButtonRef}
            type="button"
            onClick={() => setPhotoOpen(false)}
            className="absolute right-4 top-4 rounded-full bg-white/90 p-3 text-zinc-900 shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            aria-label={t("common.close")}
          >
            <X className="h-5 w-5" />
          </button>
          <div className="flex max-h-[94vh] w-full max-w-5xl flex-col items-center gap-3" onClick={(event) => event.stopPropagation()}>
            <div className="relative flex min-h-0 w-full flex-1 items-center justify-center">
              <Image src={selectedPhotoUrl} alt={`${item.name} — ${selectedPhotoIndex + 1}`} width={1600} height={1200} unoptimized className="max-h-[76vh] max-w-full object-contain" />
              {itemPhotoUrls.length > 1 ? (
                <>
                  <button type="button" onClick={() => setSelectedPhotoIndex((selectedPhotoIndex - 1 + itemPhotoUrls.length) % itemPhotoUrls.length)} aria-label={t("itemPhotos.previous")} className="absolute left-1 rounded-full bg-white/90 p-3 text-zinc-900 shadow-lg"><ChevronLeft className="h-6 w-6" /></button>
                  <button type="button" onClick={() => setSelectedPhotoIndex((selectedPhotoIndex + 1) % itemPhotoUrls.length)} aria-label={t("itemPhotos.next")} className="absolute right-1 rounded-full bg-white/90 p-3 text-zinc-900 shadow-lg"><ChevronRight className="h-6 w-6" /></button>
                </>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {itemPhotoUrls.map((photoUrl, index) => (
                <button key={photoUrl} type="button" onClick={() => setSelectedPhotoIndex(index)} aria-label={`${t("items.photo")} ${index + 1}`} className={`relative h-14 w-14 overflow-hidden rounded-lg border-2 ${index === selectedPhotoIndex ? "border-emerald-400" : "border-white/50"}`}><Image src={photoUrl} alt="" fill unoptimized className="object-cover" /></button>
              ))}
            </div>
            {canEditContent ? (
              <div className="flex items-center gap-2">
                {itemPhotoUrls.length < 4 ? <button type="button" onClick={() => { setCameraTarget("item"); setCameraOpen(true); }} disabled={capturingPhoto} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-emerald-500 px-4 text-sm font-semibold text-white disabled:opacity-50"><Plus className="h-4 w-4" />{t("itemPhotos.add")}</button> : null}
                <button type="button" onClick={() => void deletePhoto(selectedPhotoUrl)} disabled={capturingPhoto} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-red-600 disabled:opacity-50"><Trash2 className="h-4 w-4" />{t("item.deletePhoto")}</button>
              </div>
            ) : null}
            <p className="text-sm font-medium text-white">{selectedPhotoIndex + 1} / {itemPhotoUrls.length}</p>
          </div>
        </div>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(420px,0.95fr)_minmax(0,1.5fr)]">
        <div className="space-y-5">
        <section className="mt-12 rounded-2xl border border-amber-100 bg-[#fff4df] px-3 pb-5 shadow-sm">
          <div className="grid items-start gap-6 sm:grid-cols-[minmax(0,1fr)_190px]">
            <div className="relative mx-auto -mt-12 flex h-[208px] w-full max-w-[208px] items-center justify-center overflow-hidden rounded-md bg-zinc-100 shadow-lg">
              {item.photoUrl ? (
                <button
                  ref={photoTriggerRef}
                  type="button"
                  onClick={() => { setSelectedPhotoIndex(0); setPhotoOpen(true); }}
                  className="absolute inset-0 cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
                  aria-label={t("itemDetails.openPhoto")}
                >
                  <Image src={item.photoUrl} alt={item.name} fill unoptimized className="object-cover" />
                  {itemPhotoUrls.length > 1 ? <span className="absolute right-2 top-2 rounded-full bg-black/65 px-2 py-1 text-xs font-semibold text-white">{itemPhotoUrls.length} / 4</span> : null}
                </button>
              ) : (
                <div className="flex flex-col items-center gap-2 px-4 text-center text-sm text-zinc-400">
                  <ImageIcon className="h-10 w-10" />
                  {t("items.photoMissing")}
                </div>
              )}
              {canEditContent ? (
                <button
                  type="button"
                  onClick={() => { if (itemPhotoUrls.length < 4) { setCameraTarget("item"); setCameraOpen(true); } else { setSelectedPhotoIndex(0); setPhotoOpen(true); } }}
                  disabled={capturingPhoto}
                  className="absolute bottom-2 right-2 inline-flex h-11 items-center gap-2 rounded-full bg-white px-3 text-sm font-semibold text-zinc-800 shadow-lg transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60"
                >
                  <Camera className="h-4 w-4" />
                  {capturingPhoto ? t("itemDetails.saving") : itemPhotoUrls.length < 4 ? t("itemPhotos.add") : t("items.photo")}
                </button>
              ) : null}
              {canEditContent && item.photoUrl ? (
                <button type="button" onClick={() => void deletePhoto(itemPhotoUrls[0])} disabled={capturingPhoto} aria-label={t("item.deletePhoto")} className="absolute bottom-2 left-2 flex h-11 w-11 items-center justify-center rounded-full bg-white text-red-600 shadow-lg hover:bg-red-50 disabled:opacity-50"><Trash2 className="h-5 w-5" /></button>
              ) : null}
            </div>

            {canManageCode ? <div className="flex flex-col items-center pt-4 text-center print:hidden">
              {item.qrCode ? (
                <Image
                  src={`/api/inventory/items/${item.id}/qr?kind=qr&format=svg`}
                  alt={`${t("items.qrCode")}: ${item.name}`}
                  width={86.4}
                  height={86.4}
                  unoptimized
                  className="h-[86.4px] w-[86.4px]"
                />
              ) : (
                <QrCode className="h-[86.4px] w-[86.4px] text-zinc-600" strokeWidth={1.5} />
              )}
              <p className="mt-1 max-w-[190px] break-all font-mono text-sm font-medium text-zinc-700">
                {item.inventoryNumber}
              </p>
              <button
                type="button"
                onClick={() => { setCodeKind("qr"); setQrDialog("generate"); }}
                className="mt-4 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-600"
              >
                {t("items.createQr")}
              </button>
              <button type="button" onClick={() => { setCodeKind("qr"); setQrDialog("scan"); }} className="mt-3 text-xs font-medium text-emerald-600 underline underline-offset-2">
                {t("itemDetails.scanHelp")}
              </button>
              <button type="button" onClick={() => { setCodeKind("qr"); setQrDialog("purpose"); }} className="mt-1 text-xs font-medium text-emerald-600 underline underline-offset-2">
                {t("itemDetails.codePurpose")}
              </button>
            </div> : null}
          </div>

          <dl className="mt-8 divide-y divide-black/10 text-sm">
            <InventoryOverviewRow label={t("items.type")} value={t(inventoryItemCategoryTranslationKey(item.category ?? categoryFromLegacyType(item.itemType)))} />
            <InventoryOverviewRow label={t("items.object")} value={translateCampusBuilding(language, item.room.buildingName)} />
            <InventoryOverviewRow label={t("items.location")} value={item.room.designation} />
            <InventoryOverviewRow label={t("items.responsible")} value={item.responsible?.name || t("common.notAssigned")} />
            {localBarcodeInfo ? <InventoryOverviewRow label={t("itemDetails.localBarcode")} value={item.inventoryNumber} /> : null}
            {localBarcodeInfo ? <InventoryOverviewRow label={t("itemDetails.originalBarcode")} value={localBarcodeInfo.originalBarcode} /> : null}
            {localBarcodeInfo ? <InventoryOverviewRow label={t("itemDetails.transferredAt")} value={new Date(localBarcodeInfo.transferredAt).toLocaleString(locale)} /> : null}
            <InventoryOverviewRow label={t("item.condition")} value={t(`condition.${item.condition ?? "good"}`)} />
            <InventoryOverviewRow label={t("room.connected")} value={t(`connection.${item.connectionStatus ?? "not_applicable"}`)} />
            <InventoryOverviewRow label={t("items.createdAt")} value={new Date(item.createdAt).toLocaleDateString(locale)} />
            <InventoryOverviewRow label={t("itemDetails.description")} value={item.description || t("common.notSpecified")} />
          </dl>
          {item.decommissionedUsage ? (
            <section className="mt-6 rounded-2xl border border-orange-300 bg-orange-50 p-4">
              <h2 className="font-semibold text-orange-950">{t("itemDetails.decommissionedUsageTitle")}</h2>
              <dl className="mt-3 divide-y divide-orange-200 text-sm">
                <InventoryOverviewRow label={t("itemDetails.decommissionedUsageReason")} value={item.decommissionedUsage.reason || t("common.notSpecified")} />
                <InventoryOverviewRow label={t("itemDetails.decommissionedUsageComment")} value={item.decommissionedUsage.adminComment || t("common.notSpecified")} />
                <InventoryOverviewRow label={t("itemDetails.decommissionedUsageDate")} value={new Date(item.decommissionedUsage.startedAt).toLocaleString(locale)} />
              </dl>
              {item.decommissionedUsage.photoUrl ? (
                <a href={item.decommissionedUsage.photoUrl} target="_blank" rel="noreferrer" className="mt-3 block overflow-hidden rounded-xl border border-orange-200 bg-white">
                  <Image src={item.decommissionedUsage.photoUrl} alt={t("itemDetails.conditionPhoto")} width={720} height={540} unoptimized className="h-auto w-full object-cover" />
                </a>
              ) : null}
            </section>
          ) : null}
        </section>

        <LocalBarcodeDistributionPanel
          itemId={localBarcodeItemId ?? item.id}
          actorId={actorId}
          actorRole={actorRole}
        />

        {!hideComposition ? <InventoryItemComposition
          key={item.id}
          itemId={item.id}
          initialComponents={initialComponents}
          localGroups={localGroups}
          canManage={canManageComponents}
        /> : null}
        {canManageCode && item.servicePhotoUrl ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
            <h2 className="font-semibold text-amber-950">{t("service.evidence")}</h2>
            <a
              href={item.servicePhotoUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 block overflow-hidden rounded-xl border border-amber-200 bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              <Image
                src={item.servicePhotoUrl}
                alt={t("service.evidence")}
                width={720}
                height={540}
                unoptimized
                className="h-auto w-full object-cover"
              />
            </a>
          </section>
        ) : null}
        </div>

        <div className="space-y-5">
        <section className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-800">
            {t("itemDetails.recentOperations")}
          </h2>
          {operations.length ? (
            <ol className="relative mt-4 space-y-3 border-l border-sky-200 pl-4">
              {operations.map((entry) => (
                <li key={entry.kind + "-" + entry.id} className="relative rounded-xl bg-slate-50 px-4 py-3 text-sm">
                  <span className="absolute -left-[1.35rem] top-5 h-2.5 w-2.5 rounded-full border-2 border-white bg-sky-500" aria-hidden="true" />
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium text-zinc-800">
                      {operationTitle(entry, t)}
                    </p>
                    <time className="text-xs text-zinc-400" dateTime={entry.occurredAt}>
                      {new Date(entry.occurredAt).toLocaleString(locale)}
                    </time>
                  </div>
                  <p className="mt-1 text-zinc-500">
                    {entry.actorName ?? t("itemDetails.auditUnknownActor")}
                    {entry.actorEmail ? " · " + entry.actorEmail : ""}
                    {operationDetail(entry, t)}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-4 rounded-xl bg-slate-50 px-4 py-6 text-sm text-zinc-500">
              {t("itemDetails.operationsEmpty")}
            </p>
          )}
        </section>
        <InventoryItemComments
          key={commentItemId ?? item.id}
          itemId={commentItemId ?? item.id}
          initialComments={initialComments}
          canComment={canComment}
        />
        </div>
      </div>

    </div>
  );
}

function photoIdFromUrl(photoUrl: string): string | undefined {
  try {
    return new URL(photoUrl, window.location.origin).searchParams.get("photoId") ?? undefined;
  } catch {
    return undefined;
  }
}

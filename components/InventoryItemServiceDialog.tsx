"use client";

import { useAppSettings } from "@/components/AppSettingsProvider";
import Dialog from "@/components/Dialog";
import InventoryItemServiceForm from "@/components/InventoryItemServiceForm";

export default function InventoryItemServiceDialog({
  open,
  saving,
  onClose,
  onSubmit,
  onAddPhoto,
  photoAttached,
  photoRequired = false,
}: {
  open: boolean;
  saving: boolean;
  onClose(): void;
  onSubmit(input: { serviceName: string; reason: string }): void;
  onAddPhoto(): void;
  photoAttached: boolean;
  photoRequired?: boolean;
}) {
  const { t } = useAppSettings();
  if (!open) return null;
  return (
    <Dialog labelledBy="inventory-service-title" onDismiss={saving ? () => undefined : onClose} size="md" layer="critical">
      <InventoryItemServiceForm
        saving={saving}
        onClose={onClose}
        onSubmit={onSubmit}
        onAddPhoto={onAddPhoto}
        photoAttached={photoAttached}
        photoRequired={photoRequired}
      />
      <span className="sr-only">{t("items.sendToService")}</span>
    </Dialog>
  );
}

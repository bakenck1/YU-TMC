"use client";

import { Camera, Check, Wrench, X } from "lucide-react";
import { useState } from "react";

import { useAppSettings } from "@/components/AppSettingsProvider";
import Button from "@/components/Button";
import IconButton from "@/components/IconButton";
import TextareaField from "@/components/TextareaField";
import TextField from "@/components/TextField";
import Wrapper from "@/components/Wrapper";

interface InventoryItemServiceFormProps {
  saving: boolean;
  onClose(): void;
  onSubmit(input: { serviceName: string; reason: string }): void;
  onAddPhoto(): void;
  photoAttached: boolean;
  photoRequired: boolean;
}

export default function InventoryItemServiceForm({
  saving,
  onClose,
  onSubmit,
  onAddPhoto,
  photoAttached,
  photoRequired,
}: InventoryItemServiceFormProps) {
  const { t } = useAppSettings();
  const [serviceName, setServiceName] = useState("");
  const [reason, setReason] = useState("");
  const submissionDisabled = saving || !serviceName.trim() || !reason.trim() || (photoRequired && !photoAttached);

  return (
    <div className="p-6">
      <Wrapper align="start" justify="between" gap="md">
        <Wrapper align="center" gap="sm">
          <span className="rounded-xl bg-amber-50 p-2 text-amber-600">
            <Wrench className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <h2 id="inventory-service-title" className="text-lg font-semibold text-zinc-800">{t("items.serviceTitle")}</h2>
            <p className="mt-1 text-sm text-zinc-500">{t("service.subtitle")}</p>
          </div>
        </Wrapper>
        <IconButton label={t("common.close")} icon={X} variant="ghost" onClick={onClose} disabled={saving} />
      </Wrapper>

      <Wrapper direction="column" gap="md" margin={{ top: "lg" }}>
        <TextField
          label={t("items.serviceName")}
          autoFocus
          value={serviceName}
          onChange={(event) => setServiceName(event.target.value)}
          maxLength={160}
          placeholder={t("service.namePlaceholder")}
        />
        <TextareaField
          label={t("items.reason")}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={1000}
          rows={4}
          resize="none"
          placeholder={t("service.reasonPlaceholder")}
        />
        <div className="rounded-xl border border-dashed border-amber-200 bg-amber-50/60 p-3">
          <Wrapper align="center" justify="between" gap="sm">
            <div>
              <p className="text-sm font-medium text-zinc-700">
                {t("service.photo")}
                {photoRequired ? <span className="ml-1 text-red-600">({t("createItem.required")})</span> : null}
              </p>
              <p className="mt-1 text-xs text-zinc-500">{t("service.photoHint")}</p>
            </div>
            <Button variant="warning" leadingIcon={Camera} disabled={saving} onClick={onAddPhoto}>
              {t("service.attachPhoto")}
            </Button>
          </Wrapper>
          {photoAttached ? (
            <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-emerald-700">
              <Check className="h-4 w-4" aria-hidden="true" />
              {t("service.photoAttached")}
            </p>
          ) : null}
        </div>
      </Wrapper>

      <Wrapper justify="end" gap="sm" margin={{ top: "lg" }}>
        <Button disabled={saving} onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="warning-primary" disabled={submissionDisabled} loading={saving} onClick={() => onSubmit({ serviceName, reason })}>
          {saving ? t("itemDetails.sending") : t("items.sendToService")}
        </Button>
      </Wrapper>
    </div>
  );
}

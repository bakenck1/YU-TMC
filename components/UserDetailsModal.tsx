"use client";

import { useState } from "react";
import { AlertTriangle, Ban, CircleCheck, MoreHorizontal, Pencil, Trash2, X } from "lucide-react";
import type { AppUser } from "@/lib/types";
import { formatUserDate, getUserInitials } from "@/lib/user-presentation";
import { useAppSettings } from "./AppSettingsProvider";
import Badge from "./Badge";
import Button from "./Button";
import Dialog from "./Dialog";
import IconButton from "./IconButton";
import UserRoleBadge from "./UserRoleBadge";
import UserVerificationBadge from "./UserVerificationBadge";

export interface UserDetailsModalProps {
  user: AppUser;
  canMutate: boolean;
  onClose: () => void;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}

export default function UserDetailsModal({ user, canMutate, onClose, onEdit, onToggleActive, onDelete }: UserDetailsModalProps) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const { locale, t } = useAppSettings();
  const details = [
    [t("users.code"), user.code],
    [t("users.fullName"), user.fullName],
    ["Email", user.email],
    [t("users.phone"), user.phone],
    [t("users.addedAt"), formatUserDate(user.addedAt, locale)],
  ];

  return (
    <Dialog labelledBy="user-details-title" onDismiss={onClose} size="lg">
      <header className="flex items-start justify-between gap-4 border-b border-zinc-100 p-5 sm:p-6">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">{getUserInitials(user.fullName)}</div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="user-details-title" className="truncate text-xl font-semibold text-zinc-900">{user.fullName}</h2>
              <Badge tone={user.active ? "success" : "neutral"} size="sm">{user.active ? t("status.active") : t("users.deactivated")}</Badge>
            </div>
            <p className="mt-1 text-sm text-zinc-400">{user.code}</p>
          </div>
        </div>
        <IconButton label={t("common.close")} icon={X} onClick={onClose} />
      </header>

      <div className="space-y-6 p-5 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-2">
          {details.map(([label, value]) => (
            <div key={label} className="rounded-xl border border-zinc-100 bg-zinc-50/70 px-4 py-3">
              <p className="text-xs text-zinc-400">{label}</p>
              <p className="mt-1 break-words text-sm font-medium text-zinc-800">{value}</p>
              {label === "Email" ? <div className="mt-1"><UserVerificationBadge verified={user.emailVerified} /></div> : null}
            </div>
          ))}
          <div className="rounded-xl border border-zinc-100 bg-zinc-50/70 px-4 py-3">
            <p className="text-xs text-zinc-400">{t("users.role")}</p>
            <div className="mt-2"><UserRoleBadge role={user.role} /></div>
          </div>
        </div>

        {canMutate ? (
          <div className="flex flex-col gap-3 border-t border-zinc-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="primary" leadingIcon={Pencil} onClick={onEdit}>{t("users.edit")}</Button>
            <Button leadingIcon={MoreHorizontal} onClick={() => setActionsOpen((open) => !open)}>{t("users.moreActions")}</Button>
          </div>
        ) : null}

        {canMutate && actionsOpen ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
              <div><p className="text-sm font-semibold text-amber-900">{t("users.attentionActions")}</p><p className="mt-1 text-xs leading-5 text-amber-800/70">{t("users.attentionHint")}</p></div>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Button variant="warning" leadingIcon={user.active ? Ban : CircleCheck} onClick={onToggleActive}>{user.active ? t("users.deactivate") : t("users.activate")}</Button>
              <Button variant="danger-secondary" leadingIcon={Trash2} onClick={onDelete}>{t("users.delete")}</Button>
            </div>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

import { Trash2 } from "lucide-react";
import type { AppUser } from "@/lib/types";
import { useAppSettings } from "./AppSettingsProvider";
import Button from "./Button";
import Dialog from "./Dialog";

export interface UserDeleteConfirmationDialogProps {
  user: AppUser;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function UserDeleteConfirmationDialog({ user, onCancel, onConfirm }: UserDeleteConfirmationDialogProps) {
  const { t } = useAppSettings();
  return (
    <Dialog labelledBy="delete-user-title" onDismiss={onCancel} role="alertdialog" size="sm" layer="critical" scrollable={false}>
      <div className="p-6">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-100 text-red-600"><Trash2 className="h-5 w-5" aria-hidden="true" /></div>
        <h2 id="delete-user-title" className="mt-4 text-lg font-semibold text-zinc-900">{t("users.deleteQuestion")}</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-500">{t("users.deleteText", { name: user.fullName })}</p>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button onClick={onCancel}>{t("common.cancel")}</Button>
          <Button variant="danger" onClick={onConfirm}>{t("users.confirmDelete")}</Button>
        </div>
      </div>
    </Dialog>
  );
}

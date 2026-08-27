"use client";

import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import type { AppUser, UserRole } from "@/lib/types";
import { USER_ROLE_LABEL_KEYS } from "@/lib/user-presentation";
import { useAppSettings } from "./AppSettingsProvider";
import Button from "./Button";
import CheckboxField from "./CheckboxField";
import Dialog from "./Dialog";
import IconButton from "./IconButton";
import SelectField from "./SelectField";
import TextField from "./TextField";
import Wrapper from "./Wrapper";

export interface UserFormValues {
  code: string;
  fullName: string;
  iin: string;
  email: string;
  phone: string;
  role: UserRole;
  emailVerified: boolean;
  active: boolean;
  initialPassword: string;
}

export interface UserFormModalProps {
  user: AppUser | null;
  roleOptions: readonly UserRole[];
  suggestedCode: string;
  onClose: () => void;
  onSave: (values: UserFormValues) => Promise<void>;
}

export default function UserFormModal({ user, roleOptions, suggestedCode, onClose, onSave }: UserFormModalProps) {
  const { t } = useAppSettings();
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState<UserFormValues>({
    code: user?.code ?? suggestedCode,
    fullName: user?.fullName ?? "",
    iin: user?.iin ?? "",
    email: user?.email ?? "",
    phone: user?.phone === "—" ? "" : (user?.phone ?? ""),
    role: user?.role ?? "employee",
    emailVerified: user?.emailVerified ?? false,
    active: user?.active ?? false,
    initialPassword: "",
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave({
        ...values,
        code: values.code.trim(),
        fullName: values.fullName.trim(),
        iin: values.iin.trim(),
        email: values.email.trim(),
        phone: values.phone.trim() || "—",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog labelledBy="user-form-title" onDismiss={onClose} size="lg">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-100 bg-white px-5 py-4 sm:px-6">
        <div>
          <h2 id="user-form-title" className="text-lg font-semibold text-zinc-900">{user ? t("users.editTitle") : t("users.createTitle")}</h2>
          <p className="mt-0.5 text-sm text-zinc-400">{user ? t("users.editSubtitle") : t("users.createSubtitle")}</p>
        </div>
        <IconButton label={t("common.close")} icon={X} onClick={onClose} />
      </header>

      <form onSubmit={submit} className="p-5 sm:p-6">
        <Wrapper display="grid" columns={1} gap="md" responsive={{ at: "sm", columns: 2 }}>
          <TextField required label={t("users.fullName")} value={values.fullName} onChange={(event) => setValues((current) => ({ ...current, fullName: event.target.value }))} placeholder={t("users.fullNamePlaceholder")} />
          <TextField required readOnly label={t("users.code")} value={values.code} placeholder={t("users.codePlaceholder")} />
          <TextField required inputMode="numeric" pattern="[0-9]{12}" minLength={12} maxLength={12} label="ИИН" value={values.iin} onChange={(event) => setValues((current) => ({ ...current, iin: event.target.value.replace(/\D/g, "").slice(0, 12) }))} placeholder="000000000000" />
          <TextField required type="email" readOnly={user !== null} label="Email" value={values.email} onChange={(event) => setValues((current) => ({ ...current, email: event.target.value }))} placeholder="name@example.com" />
          <TextField type="tel" label={t("users.phone")} value={values.phone} onChange={(event) => setValues((current) => ({ ...current, phone: event.target.value }))} placeholder={t("users.phonePlaceholder")} />
        </Wrapper>

        <Wrapper display="block" margin={{ top: "md" }}>
          <SelectField
            label={t("users.role")}
            fieldSize="lg"
            value={values.role}
            onChange={(event) => setValues((current) => ({ ...current, role: event.target.value as UserRole }))}
            options={roleOptions.map((role) => ({ value: role, label: t(USER_ROLE_LABEL_KEYS[role]) }))}
          />
        </Wrapper>
        <Wrapper display="block" margin={{ top: "md" }}>
          <TextField
            type="password"
            minLength={12}
            maxLength={128}
            label={t(user ? "users.newTemporaryPassword" : "users.temporaryPassword")}
            value={values.initialPassword}
            onChange={(event) => setValues((current) => ({ ...current, initialPassword: event.target.value }))}
            placeholder={t("users.passwordPlaceholder")}
            hint={user ? t("users.keepPasswordHint") : t("users.passwordSsoHint")}
          />
        </Wrapper>

        <div className="mt-6 grid gap-3 rounded-2xl bg-zinc-50 p-4 sm:grid-cols-2">
          <CheckboxField label={t("users.isActive")} hint={t("users.isActiveHint")} checked={values.active} onChange={(event) => setValues((current) => ({ ...current, active: event.target.checked }))} />
          <CheckboxField label={t("users.emailVerified")} hint={t("users.emailVerifiedHint")} checked={values.emailVerified} onChange={(event) => setValues((current) => ({ ...current, emailVerified: event.target.checked }))} />
          {!user ? <p className="text-xs leading-5 text-zinc-500 sm:col-span-2">{t("users.ssoProvisioningHint")}</p> : null}
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 border-t border-zinc-100 pt-5 sm:flex-row sm:justify-end">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" loading={saving}>{user ? t("users.saveChanges") : t("users.create")}</Button>
        </div>
      </form>
    </Dialog>
  );
}

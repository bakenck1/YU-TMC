"use client";

import { FormEvent, KeyboardEvent, useMemo, useState } from "react";
import {
  AlertTriangle,
  Ban,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import type { AppUser, UserRole } from "@/lib/types";
import { useAppSettings } from "./AppSettingsProvider";
import type { TranslationKey } from "@/lib/i18n";

type SortKey = "fullName" | "email" | "role" | "addedAt";
type SortDirection = "asc" | "desc";
type EmailFilter = "all" | "verified" | "unverified";

const ROLE_OPTIONS: UserRole[] = ["Админ", "Владелец", "Кладовщик", "Сотрудник"];

const ROLE_STYLES: Record<UserRole, string> = {
  Админ: "bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
  Владелец: "bg-slate-800 text-white ring-1 ring-inset ring-slate-950/10",
  Кладовщик: "bg-sky-100 text-sky-700 ring-1 ring-inset ring-sky-600/20",
  Сотрудник: "bg-zinc-100 text-zinc-600 ring-1 ring-inset ring-zinc-500/20",
};

const INPUT_CLASS =
  "mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm text-zinc-800 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10";

function formatDate(iso: string, locale: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(locale, {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

const ROLE_LABEL_KEYS: Record<UserRole, TranslationKey> = {
  Админ: "users.admin",
  Владелец: "users.owner",
  Кладовщик: "users.warehouse",
  Сотрудник: "users.employee",
};

function getInitials(fullName: string) {
  return fullName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function RoleBadge({ role }: { role: UserRole }) {
  const { t } = useAppSettings();
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${ROLE_STYLES[role]}`}>
      {t(ROLE_LABEL_KEYS[role])}
    </span>
  );
}

function VerificationBadge({ verified }: { verified: boolean }) {
  const { t } = useAppSettings();
  return (
    <span
      className={`mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
        verified ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"
      }`}
    >
      {verified && <Check className="h-3 w-3" strokeWidth={2.5} />}
      {verified ? t("users.verified") : t("users.unverified")}
    </span>
  );
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
}) {
  const active = activeKey === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap transition ${
        active ? "text-zinc-700" : "text-zinc-400 hover:text-zinc-600"
      }`}
    >
      {label}
      {active ? (
        direction === "asc" ? (
          <ChevronUp className="h-3.5 w-3.5 text-emerald-600" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-emerald-600" />
        )
      ) : (
        <span className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

interface UserFormValues {
  code: string;
  fullName: string;
  email: string;
  phone: string;
  role: UserRole;
  emailVerified: boolean;
  active: boolean;
  sendInvitation: boolean;
}

function UserFormModal({
  user,
  suggestedCode,
  onClose,
  onSave,
}: {
  user: AppUser | null;
  suggestedCode: string;
  onClose: () => void;
  onSave: (values: UserFormValues) => void;
}) {
  const { t } = useAppSettings();
  const [values, setValues] = useState<UserFormValues>({
    code: user?.code ?? suggestedCode,
    fullName: user?.fullName ?? "",
    email: user?.email ?? "",
    phone: user?.phone === "—" ? "" : (user?.phone ?? ""),
    role: user?.role ?? "Сотрудник",
    emailVerified: user?.emailVerified ?? false,
    active: user?.active ?? true,
    sendInvitation: user?.invitationSent ?? true,
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({
      ...values,
      code: values.code.trim(),
      fullName: values.fullName.trim(),
      email: values.email.trim(),
      phone: values.phone.trim() || "—",
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-form-title"
        className="max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-2xl border border-black/5 bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-100 bg-white px-5 py-4 sm:px-6">
          <div>
            <h2 id="user-form-title" className="text-lg font-semibold text-zinc-900">
              {user ? t("users.editTitle") : t("users.createTitle")}
            </h2>
            <p className="mt-0.5 text-sm text-zinc-400">
              {user ? t("users.editSubtitle") : t("users.createSubtitle")}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" aria-label={t("common.close")}>
            <X className="h-5 w-5" />
          </button>
        </header>

        <form onSubmit={submit} className="space-y-6 p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-zinc-700">
              {t("users.fullName")}
              <input
                required
                value={values.fullName}
                onChange={(event) => setValues((current) => ({ ...current, fullName: event.target.value }))}
                placeholder={t("users.fullNamePlaceholder")}
                className={INPUT_CLASS}
              />
            </label>
            <label className="text-sm font-medium text-zinc-700">
              {t("users.code")}
              <input
                required
                value={values.code}
                onChange={(event) => setValues((current) => ({ ...current, code: event.target.value }))}
                placeholder={t("users.codePlaceholder")}
                className={INPUT_CLASS}
              />
            </label>
            <label className="text-sm font-medium text-zinc-700">
              Email
              <input
                required
                type="email"
                value={values.email}
                onChange={(event) => setValues((current) => ({ ...current, email: event.target.value }))}
                placeholder="name@example.com"
                className={INPUT_CLASS}
              />
            </label>
            <label className="text-sm font-medium text-zinc-700">
              {t("users.phone")}
              <input
                type="tel"
                value={values.phone}
                onChange={(event) => setValues((current) => ({ ...current, phone: event.target.value }))}
                placeholder={t("users.phonePlaceholder")}
                className={INPUT_CLASS}
              />
            </label>
            <label className="text-sm font-medium text-zinc-700 sm:col-span-2">
              {t("users.role")}
              <select
                value={values.role}
                onChange={(event) => setValues((current) => ({ ...current, role: event.target.value as UserRole }))}
                className={INPUT_CLASS}
              >
                {ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {t(ROLE_LABEL_KEYS[role])}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 rounded-2xl bg-zinc-50 p-4 sm:grid-cols-2">
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-transparent p-2 hover:border-zinc-200 hover:bg-white">
              <input
                type="checkbox"
                checked={values.active}
                onChange={(event) => setValues((current) => ({ ...current, active: event.target.checked }))}
                className="mt-0.5 h-4 w-4 accent-emerald-600"
              />
              <span>
                <span className="block text-sm font-medium text-zinc-700">{t("users.isActive")}</span>
                <span className="mt-0.5 block text-xs text-zinc-400">{t("users.isActiveHint")}</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-transparent p-2 hover:border-zinc-200 hover:bg-white">
              <input
                type="checkbox"
                checked={values.emailVerified}
                onChange={(event) => setValues((current) => ({ ...current, emailVerified: event.target.checked }))}
                className="mt-0.5 h-4 w-4 accent-emerald-600"
              />
              <span>
                <span className="block text-sm font-medium text-zinc-700">{t("users.emailVerified")}</span>
                <span className="mt-0.5 block text-xs text-zinc-400">{t("users.emailVerifiedHint")}</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-transparent p-2 hover:border-zinc-200 hover:bg-white sm:col-span-2">
              <input
                type="checkbox"
                checked={values.sendInvitation}
                onChange={(event) => setValues((current) => ({ ...current, sendInvitation: event.target.checked }))}
                className="mt-0.5 h-4 w-4 accent-emerald-600"
              />
              <span>
                <span className="block text-sm font-medium text-zinc-700">{t("users.sendInvitation")}</span>
                <span className="mt-0.5 block text-xs text-zinc-400">{t("users.sendInvitationHint")}</span>
              </span>
            </label>
          </div>

          <div className="flex flex-col-reverse gap-3 border-t border-zinc-100 pt-5 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50">
              {t("common.cancel")}
            </button>
            <button type="submit" className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700">
              {user ? t("users.saveChanges") : t("users.create")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function UserDetailsModal({
  user,
  onClose,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  user: AppUser;
  onClose: () => void;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const { locale, t } = useAppSettings();

  const details = [
    [t("users.code"), user.code],
    [t("users.fullName"), user.fullName],
    ["Email", user.email],
    [t("users.phone"), user.phone],
    [t("users.addedAt"), formatDate(user.addedAt, locale)],
  ];

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-details-title"
        className="max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-2xl border border-black/5 bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-zinc-100 p-5 sm:p-6">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">
              {getInitials(user.fullName)}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="user-details-title" className="truncate text-xl font-semibold text-zinc-900">
                  {user.fullName}
                </h2>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${user.active ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-500"}`}>
                  {user.active ? t("status.active") : t("users.deactivated")}
                </span>
              </div>
              <p className="mt-1 text-sm text-zinc-400">{user.code}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" aria-label={t("common.close")}>
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="space-y-6 p-5 sm:p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            {details.map(([label, value]) => (
              <div key={label} className="rounded-xl border border-zinc-100 bg-zinc-50/70 px-4 py-3">
                <p className="text-xs text-zinc-400">{label}</p>
                <p className="mt-1 break-words text-sm font-medium text-zinc-800">{value}</p>
                {label === "Email" && <VerificationBadge verified={user.emailVerified} />}
              </div>
            ))}
            <div className="rounded-xl border border-zinc-100 bg-zinc-50/70 px-4 py-3">
              <p className="text-xs text-zinc-400">{t("users.role")}</p>
              <div className="mt-2">
                <RoleBadge role={user.role} />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-zinc-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" onClick={onEdit} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700">
              <Pencil className="h-4 w-4" />
              {t("users.edit")}
            </button>
            <button
              type="button"
              onClick={() => setActionsOpen((open) => !open)}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50"
            >
              <MoreHorizontal className="h-4 w-4" />
              {t("users.moreActions")}
            </button>
          </div>

          {actionsOpen && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                <div>
                  <p className="text-sm font-semibold text-amber-900">{t("users.attentionActions")}</p>
                  <p className="mt-1 text-xs leading-5 text-amber-800/70">{t("users.attentionHint")}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <button type="button" onClick={onToggleActive} className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-white px-4 py-2.5 text-sm font-medium text-amber-800 hover:bg-amber-100">
                  {user.active ? <Ban className="h-4 w-4" /> : <CircleCheck className="h-4 w-4" />}
                  {user.active ? t("users.deactivate") : t("users.activate")}
                </button>
                <button type="button" onClick={onDelete} className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50">
                  <Trash2 className="h-4 w-4" />
                  {t("users.delete")}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function DeleteConfirmation({
  user,
  onCancel,
  onConfirm,
}: {
  user: AppUser;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useAppSettings();
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 p-4" onMouseDown={onCancel}>
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-user-title"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-100 text-red-600">
          <Trash2 className="h-5 w-5" />
        </div>
        <h2 id="delete-user-title" className="mt-4 text-lg font-semibold text-zinc-900">
          {t("users.deleteQuestion")}
        </h2>
        <p className="mt-2 text-sm leading-6 text-zinc-500">
          {t("users.deleteText", { name: user.fullName })}
        </p>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50">
            {t("common.cancel")}
          </button>
          <button type="button" onClick={onConfirm} className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700">
            {t("users.confirmDelete")}
          </button>
        </div>
      </section>
    </div>
  );
}

export default function UsersManager({ initialUsers }: { initialUsers: AppUser[] }) {
  const { locale, t } = useAppSettings();
  const [records, setRecords] = useState(initialUsers);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | UserRole>("all");
  const [emailFilter, setEmailFilter] = useState<EmailFilter>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("fullName");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formUserId, setFormUserId] = useState<string | null | undefined>(undefined);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const selectedUser = records.find((user) => user.id === selectedId) ?? null;
  const formUser = formUserId === null ? null : records.find((user) => user.id === formUserId) ?? null;
  const deleteUser = records.find((user) => user.id === deleteId) ?? null;

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU");

    return records
      .filter((user) => {
        const searchable = [user.code, user.fullName, user.email, user.role, t(ROLE_LABEL_KEYS[user.role]), user.phone]
          .join(" ")
          .toLocaleLowerCase("ru-RU");
        const matchesQuery = !normalizedQuery || searchable.includes(normalizedQuery);
        const matchesRole = roleFilter === "all" || user.role === roleFilter;
        const matchesEmail =
          emailFilter === "all" ||
          (emailFilter === "verified" ? user.emailVerified : !user.emailVerified);
        return matchesQuery && matchesRole && matchesEmail;
      })
      .sort((first, second) => {
        const firstValue = first[sortKey];
        const secondValue = second[sortKey];
        const comparison =
          sortKey === "addedAt"
            ? new Date(firstValue).getTime() - new Date(secondValue).getTime()
            : firstValue.localeCompare(secondValue, "ru", { sensitivity: "base" });
        return sortDirection === "asc" ? comparison : -comparison;
      });
  }, [emailFilter, query, records, roleFilter, sortDirection, sortKey, t]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const visibleUsers = filteredUsers.slice(startIndex, startIndex + pageSize);
  const rangeStart = filteredUsers.length === 0 ? 0 : startIndex + 1;
  const rangeEnd = Math.min(startIndex + pageSize, filteredUsers.length);
  const hasActiveFilters = roleFilter !== "all" || emailFilter !== "all";
  const nextCodeNumber =
    records.reduce((highest, user) => {
      const numericPart = Number(user.code.match(/\d+/)?.[0] ?? 0);
      return Math.max(highest, numericPart);
    }, 0) + 1;
  const suggestedCode = `USR-${String(nextCodeNumber).padStart(3, "0")}`;

  function resetPage() {
    setPage(1);
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
    resetPage();
  }

  function openRow(userId: string) {
    setSelectedId(userId);
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, userId: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openRow(userId);
    }
  }

  function saveUser(values: UserFormValues) {
    const existing = formUserId ? records.find((user) => user.id === formUserId) : null;
    const { sendInvitation, ...userValues } = values;

    if (existing) {
      setRecords((current) =>
        current.map((user) =>
          user.id === existing.id
            ? {
                ...user,
                ...userValues,
                invitationSent: sendInvitation,
              }
            : user,
        ),
      );
      setSelectedId(existing.id);
    } else {
      const nextNumericId = records.reduce((highest, user) => Math.max(highest, Number(user.id) || 0), 0) + 1;
      const created: AppUser = {
        id: String(nextNumericId),
        ...userValues,
        invitationSent: sendInvitation,
        addedAt: new Date().toISOString().slice(0, 10),
      };
      setRecords((current) => [created, ...current]);
      setSelectedId(created.id);
      resetPage();
    }

    setFormUserId(undefined);
  }

  function toggleActive(userId: string) {
    setRecords((current) =>
      current.map((user) => (user.id === userId ? { ...user, active: !user.active } : user)),
    );
  }

  function deleteRecord() {
    if (!deleteId) return;
    setRecords((current) => current.filter((user) => user.id !== deleteId));
    setDeleteId(null);
    setSelectedId(null);
  }

  function clearFilters() {
    setRoleFilter("all");
    setEmailFilter("all");
    resetPage();
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">{t("users.searchLabel")}</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-zinc-400" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                resetPage();
              }}
              placeholder={t("common.search")}
              className="h-11 w-full rounded-xl border border-zinc-200 bg-zinc-50/60 pl-10 pr-10 text-sm text-zinc-800 outline-none transition placeholder:text-zinc-400 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  resetPage();
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                aria-label={t("users.clearSearch")}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </label>

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => setFiltersOpen((open) => !open)}
              className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-medium transition ${
                filtersOpen || hasActiveFilters
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              <SlidersHorizontal className="h-4 w-4" />
              {t("users.filters")}
              {hasActiveFilters && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-600 px-1.5 text-[11px] text-white">{Number(roleFilter !== "all") + Number(emailFilter !== "all")}</span>}
            </button>
            <button
              type="button"
              onClick={() => setFormUserId(null)}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
            >
              <Plus className="h-4 w-4" />
              {t("users.create")}
            </button>
          </div>
        </div>

        {filtersOpen && (
          <div className="mt-4 grid gap-3 border-t border-zinc-100 pt-4 sm:grid-cols-2 lg:max-w-2xl">
            <label className="text-xs font-medium text-zinc-500">
              {t("users.role")}
              <select
                value={roleFilter}
                onChange={(event) => {
                  setRoleFilter(event.target.value as "all" | UserRole);
                  resetPage();
                }}
                className="mt-1.5 h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10"
              >
                <option value="all">{t("users.allRoles")}</option>
                {ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {t(ROLE_LABEL_KEYS[role])}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-zinc-500">
              {t("users.emailStatus")}
              <select
                value={emailFilter}
                onChange={(event) => {
                  setEmailFilter(event.target.value as EmailFilter);
                  resetPage();
                }}
                className="mt-1.5 h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10"
              >
                <option value="all">{t("users.allStatuses")}</option>
                <option value="verified">{t("users.verified")}</option>
                <option value="unverified">{t("users.unverified")}</option>
              </select>
            </label>
          </div>
        )}

        {hasActiveFilters && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-zinc-400">{t("users.activeFilters")}</span>
            {roleFilter !== "all" && (
              <button
                type="button"
                onClick={() => {
                  setRoleFilter("all");
                  resetPage();
                }}
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
              >
                {t("users.roleFilter", { role: t(ROLE_LABEL_KEYS[roleFilter]) })}
                <X className="h-3 w-3" />
              </button>
            )}
            {emailFilter !== "all" && (
              <button
                type="button"
                onClick={() => {
                  setEmailFilter("all");
                  resetPage();
                }}
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
              >
                {t("users.emailFilter", { status: emailFilter === "verified" ? t("users.verified") : t("users.unverified") })}
                <X className="h-3 w-3" />
              </button>
            )}
            <button type="button" onClick={clearFilters} className="text-xs font-medium text-zinc-500 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-800">
              {t("users.clearAll")}
            </button>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] table-fixed text-left text-sm">
            <colgroup>
              <col className="w-[9%]" />
              <col className="w-[22%]" />
              <col className="w-[23%]" />
              <col className="w-[17%]" />
              <col className="w-[14%]" />
              <col className="w-[15%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50/50 text-xs uppercase tracking-wide">
                <th className="px-4 py-4 font-medium text-zinc-400">{t("users.columnCode")}</th>
                <th className="px-4 py-4 font-medium">
                  <SortHeader label={t("users.fullName")} sortKey="fullName" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                </th>
                <th className="px-4 py-4 font-medium">
                  <SortHeader label="Email" sortKey="email" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                </th>
                <th className="px-4 py-4 font-medium">
                  <SortHeader label={t("users.role")} sortKey="role" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                </th>
                <th className="px-4 py-4 font-medium text-zinc-400">{t("users.phone")}</th>
                <th className="px-4 py-4 font-medium">
                  <SortHeader label={t("users.addedAt")} sortKey="addedAt" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((user) => (
                <tr
                  key={user.id}
                  tabIndex={0}
                  onClick={() => openRow(user.id)}
                  onKeyDown={(event) => handleRowKeyDown(event, user.id)}
                  className="cursor-pointer border-b border-zinc-100 outline-none transition last:border-0 hover:bg-emerald-50/40 focus:bg-emerald-50/50"
                >
                  <td className="px-4 py-3.5 font-mono text-xs font-medium text-zinc-500">{user.code}</td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-xs font-bold text-emerald-700">
                        {getInitials(user.fullName)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-zinc-800 hover:text-emerald-700">{user.fullName}</p>
                        <p className={`mt-0.5 text-[11px] ${user.active ? "text-emerald-600" : "text-zinc-400"}`}>
                          {user.active ? t("status.active") : t("users.deactivated")}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <p className="truncate text-zinc-600">{user.email}</p>
                    <VerificationBadge verified={user.emailVerified} />
                  </td>
                  <td className="px-4 py-3.5">
                    <RoleBadge role={user.role} />
                  </td>
                  <td className="px-4 py-3.5 text-zinc-500">{user.phone}</td>
                  <td className="px-4 py-3.5 text-zinc-500">{formatDate(user.addedAt, locale)}</td>
                </tr>
              ))}
              {visibleUsers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-400">
                      <UserRound className="h-5 w-5" />
                    </div>
                    <p className="mt-3 font-medium text-zinc-700">{t("users.empty")}</p>
                    <p className="mt-1 text-sm text-zinc-400">{t("users.emptyHint")}</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <footer className="flex flex-col gap-3 border-t border-zinc-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-2 text-xs text-zinc-500">
            {t("users.perPage")}
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                resetPage();
              }}
              className="h-8 rounded-lg border border-zinc-200 bg-white px-2 text-sm text-zinc-700 outline-none focus:border-emerald-400"
            >
              {[10, 20, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center justify-between gap-4 sm:justify-end">
            <span className="whitespace-nowrap text-xs text-zinc-500">
              {t("users.range", { from: rangeStart, to: rangeEnd, total: filteredUsers.length })}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={currentPage <= 1}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-35"
                aria-label={t("users.previousPage")}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={currentPage >= totalPages}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-35"
                aria-label={t("users.nextPage")}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </footer>
      </section>

      {selectedUser && (
        <UserDetailsModal
          user={selectedUser}
          onClose={() => setSelectedId(null)}
          onEdit={() => setFormUserId(selectedUser.id)}
          onToggleActive={() => toggleActive(selectedUser.id)}
          onDelete={() => setDeleteId(selectedUser.id)}
        />
      )}

      {formUserId !== undefined && (
        <UserFormModal
          key={formUserId ?? "create"}
          user={formUser}
          suggestedCode={suggestedCode}
          onClose={() => setFormUserId(undefined)}
          onSave={saveUser}
        />
      )}

      {deleteUser && <DeleteConfirmation user={deleteUser} onCancel={() => setDeleteId(null)} onConfirm={deleteRecord} />}
    </div>
  );
}

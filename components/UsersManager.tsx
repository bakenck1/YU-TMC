"use client";

import { type KeyboardEvent, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  SlidersHorizontal,
  UserRound,
  X,
} from "lucide-react";
import type { AppUser, UserRole } from "@/lib/types";
import type { UserDto } from "@/lib/contracts/users";
import type { TranslationKey } from "@/lib/i18n";
import { canManageUser } from "@/lib/security/permissions";
import { formatUserDate, getUserInitials, USER_ROLE_LABEL_KEYS } from "@/lib/user-presentation";
import { useAppSettings } from "./AppSettingsProvider";
import SortableTableHeader from "./SortableTableHeader";
import UserDeleteConfirmationDialog from "./UserDeleteConfirmationDialog";
import UserDetailsModal from "./UserDetailsModal";
import UserFormModal, { type UserFormValues } from "./UserFormModal";
import UserRoleBadge from "./UserRoleBadge";
import UserVerificationBadge from "./UserVerificationBadge";

type SortKey = "fullName" | "email" | "role" | "addedAt";
type SortDirection = "asc" | "desc";
type EmailFilter = "all" | "verified" | "unverified";

const ROLE_OPTIONS: UserRole[] = ["admin", "warehouse", "employee"];

export default function UsersManager({
  initialUsers,
  actorRole,
}: {
  initialUsers: AppUser[];
  actorRole: UserRole;
}) {
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
  const [mutationError, setMutationError] = useState<string | null>(null);

  const selectedUser = records.find((user) => user.id === selectedId) ?? null;
  const formUser = formUserId === null ? null : records.find((user) => user.id === formUserId) ?? null;
  const roleOptions =
    actorRole === "admin"
      ? ROLE_OPTIONS
      : (["warehouse", "employee"] as const);
  const canMutateSelectedUser =
    selectedUser !== null &&
    canManageUser(actorRole, {
      currentRole: selectedUser.role,
      nextRole: selectedUser.role,
    });
  const deleteUser = records.find((user) => user.id === deleteId) ?? null;

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU");

    return records
      .filter((user) => {
        const searchable = [user.code, user.fullName, user.email, user.role, t(USER_ROLE_LABEL_KEYS[user.role]), user.phone]
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
  const suggestedCode = t("users.codeAutomatic");

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

  async function saveUser(values: UserFormValues) {
    const existing = formUserId ? records.find((user) => user.id === formUserId) : null;
    setMutationError(null);
    const response = await fetch(
      existing ? `/api/users/${encodeURIComponent(existing.id)}` : "/api/users",
      {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          existing
            ? {
                fullName: values.fullName,
                phone: values.phone,
                role: values.role,
                emailVerified: values.emailVerified,
                active: values.active,
                version: existing.version,
                initialPassword: values.initialPassword || undefined,
              }
            : {
                fullName: values.fullName,
                email: values.email,
                phone: values.phone,
                role: values.role,
                emailVerified: values.emailVerified,
                active: values.active,
                initialPassword: values.initialPassword || undefined,
              },
        ),
      },
    );
    if (!response.ok) {
      setMutationError(await userMutationError(response, t));
      return;
    }
    const payload = (await response.json()) as { user: UserDto };
    const saved = normalizeUser(payload.user);
    setRecords((current) =>
      existing
        ? current.map((user) => (user.id === saved.id ? saved : user))
        : [saved, ...current],
    );
    setSelectedId(saved.id);
    if (!existing) resetPage();
    setFormUserId(undefined);
  }

  async function toggleActive(userId: string) {
    const user = records.find((candidate) => candidate.id === userId);
    if (!user) return;
    setMutationError(null);
    const response = await fetch(`/api/users/${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: user.fullName,
        phone: user.phone,
        role: user.role,
        emailVerified: user.emailVerified,
        active: !user.active,
        version: user.version,
      }),
    });
    if (!response.ok) {
      setMutationError(await userMutationError(response, t));
      return;
    }
    const payload = (await response.json()) as { user: UserDto };
    const updated = normalizeUser(payload.user);
    setRecords((current) =>
      current.map((candidate) =>
        candidate.id === updated.id ? updated : candidate,
      ),
    );
  }

  async function deleteRecord() {
    if (!deleteId) return;
    const user = records.find((candidate) => candidate.id === deleteId);
    if (!user) return;
    setMutationError(null);
    const response = await fetch(
      `/api/users/${encodeURIComponent(deleteId)}?version=${user.version}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      setMutationError(await userMutationError(response, t));
      return;
    }
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
      {mutationError && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {mutationError}
        </div>
      )}
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
                    {t(USER_ROLE_LABEL_KEYS[role])}
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
                {t("users.roleFilter", { role: t(USER_ROLE_LABEL_KEYS[roleFilter]) })}
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
                  <SortableTableHeader label={t("users.fullName")} sortKey="fullName" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                </th>
                <th className="px-4 py-4 font-medium">
                  <SortableTableHeader label="Email" sortKey="email" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                </th>
                <th className="px-4 py-4 font-medium">
                  <SortableTableHeader label={t("users.role")} sortKey="role" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                </th>
                <th className="px-4 py-4 font-medium text-zinc-400">{t("users.phone")}</th>
                <th className="px-4 py-4 font-medium">
                  <SortableTableHeader label={t("users.addedAt")} sortKey="addedAt" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
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
                        {getUserInitials(user.fullName)}
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
                    <UserVerificationBadge verified={user.emailVerified} />
                  </td>
                  <td className="px-4 py-3.5">
                    <UserRoleBadge role={user.role} />
                  </td>
                  <td className="px-4 py-3.5 text-zinc-500">{user.phone}</td>
                  <td className="px-4 py-3.5 text-zinc-500">{formatUserDate(user.addedAt, locale)}</td>
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
          canMutate={canMutateSelectedUser}
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
          roleOptions={roleOptions}
          suggestedCode={suggestedCode}
          onClose={() => setFormUserId(undefined)}
          onSave={saveUser}
        />
      )}

      {deleteUser && <UserDeleteConfirmationDialog user={deleteUser} onCancel={() => setDeleteId(null)} onConfirm={deleteRecord} />}
    </div>
  );
}
function normalizeUser(user: UserDto): AppUser {
  return {
    ...user,
    phone: user.phone || "—",
  };
}

async function userMutationError(
  response: Response,
  t: (key: TranslationKey) => string,
): Promise<string> {
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  if (payload?.error === "user_version_conflict") {
    return t("users.conflictError");
  }
  if (payload?.error === "last_active_admin") {
    return t("users.lastAdminError");
  }
  if (payload?.error === "email_already_exists") {
    return t("users.duplicateEmailError");
  }
  if (payload?.error === "user_login_not_configured") {
    return t("users.loginMethodError");
  }
  if (payload?.error === "invalid_initial_password") {
    return t("users.passwordLengthError");
  }
  if (response.status === 403) {
    return t("users.forbiddenError");
  }
  return t("users.saveError");
}

"use client";

import { Check, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { useAppSettings } from "@/components/AppSettingsProvider";
import type { TmcOperationUserDto } from "@/lib/contracts/tmc-operations";
import type { TranslationKey } from "@/lib/i18n";
import {
  installTmcRecipientSearchController,
  normalizeTmcRecipientQuery,
  reconcileTmcUserPickerQuery,
  TMC_RECIPIENT_QUERY_MAX_LENGTH,
  type TmcRecipientSearchController,
  type TmcRecipientSearchState,
} from "@/lib/tmc-recipient-search";

const ROLE_LABEL_KEYS = {
  admin: "users.admin",
  warehouse: "users.warehouse",
  employee: "users.employee",
} as const satisfies Record<TmcOperationUserDto["role"], TranslationKey>;

export default function TmcUserPicker({
  value,
  onChange,
}: {
  value: TmcOperationUserDto | null;
  onChange: (user: TmcOperationUserDto | null) => void;
}) {
  const { t } = useAppSettings();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<TmcRecipientSearchController | null>(null);
  const listboxId = useId();
  const [queryState, setQueryState] = useState({
    query: value?.fullName ?? "",
    valueId: value?.id ?? null,
  });
  const reconciledQueryState = reconcileTmcUserPickerQuery(queryState, value);
  if (reconciledQueryState !== queryState) {
    setQueryState(reconciledQueryState);
  }
  const query = reconciledQueryState.query;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [searchState, setSearchState] = useState<TmcRecipientSearchState>({
    status: "idle",
  });

  useEffect(
    () =>
      installTmcRecipientSearchController(controllerRef, {
        fetcher: (url, init) => fetch(url, init),
        onState: (state) => {
          setSearchState(state);
          setActiveIndex(
            state.status === "ready" && state.users.length > 0 ? 0 : -1,
          );
        },
      }),
    [],
  );
  useEffect(() => {
    if (open) controllerRef.current?.search(query);
    else controllerRef.current?.reset();
  }, [open, query]);
  const users = searchState.status === "ready" ? searchState.users : [];
  const activeUser = activeIndex >= 0 ? users[activeIndex] : undefined;
  const activeOptionId = open && activeUser
    ? `${listboxId}-${activeUser.id}`
    : undefined;
  const shortQuery = Array.from(normalizeTmcRecipientQuery(query)).length < 2;
  const statusKey: TranslationKey | null = shortQuery
    ? "tmc.recipient.minChars"
    : searchState.status === "error"
      ? "tmc.recipient.error"
      : searchState.status === "ready" && users.length === 0
        ? "tmc.recipient.empty"
        : searchState.status === "ready"
          ? null
          : "tmc.recipient.loading";
  const showsOptions = statusKey === null;

  useEffect(() => {
    if (!activeOptionId) return;
    document
      .getElementById(activeOptionId)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeOptionId]);

  function select(user: TmcOperationUserDto) {
    setQueryState({ query: user.fullName, valueId: user.id });
    onChange(user);
    setOpen(false);
    controllerRef.current?.reset();
  }

  function clear() {
    setQueryState({ query: "", valueId: null });
    onChange(null);
    setOpen(true);
    controllerRef.current?.reset();
    inputRef.current?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, users.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Home") {
      if (!open || users.length === 0) return;
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      if (!open || users.length === 0) return;
      event.preventDefault();
      setActiveIndex(users.length - 1);
    } else if (event.key === "Enter") {
      if (!open || !activeUser) return;
      event.preventDefault();
      select(activeUser);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div
      ref={rootRef}
      className="relative mt-5"
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <label htmlFor={`${listboxId}-input`} className="block text-sm font-semibold text-zinc-800">
        {t("tmc.recipient.label")}
      </label>
      <div className="relative mt-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
        <input
          ref={inputRef}
          id={`${listboxId}-input`}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-haspopup="listbox"
          aria-activedescendant={activeOptionId}
          autoComplete="off"
          maxLength={TMC_RECIPIENT_QUERY_MAX_LENGTH}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQueryState({ query: event.target.value, valueId: null });
            if (value) onChange(null);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={t("tmc.recipient.placeholder")}
          className="min-h-11 w-full rounded-xl border border-zinc-200 bg-white py-2.5 pl-10 pr-12 text-sm text-zinc-900 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
        />
        {value || query ? (
          <button type="button" onClick={clear} aria-label={t("tmc.recipient.clear")} className="absolute right-1 top-1/2 inline-flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {value ? (
        <p aria-live="polite" className="mt-2 text-xs text-zinc-600">
          {value.email} · {t(ROLE_LABEL_KEYS[value.role])}
        </p>
      ) : null}

      {open ? (
        <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl">
          <div
            id={listboxId}
            role="listbox"
            className="max-h-64 overflow-y-auto p-1"
          >
          {showsOptions ? (
            <>
              {users.map((user, index) => (
                <div
                  id={`${listboxId}-${user.id}`}
                  key={user.id}
                  role="option"
                  aria-selected={value?.id === user.id}
                  onPointerDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => select(user)}
                  className={`min-h-11 cursor-pointer rounded-lg px-3 py-2.5 text-sm ${index === activeIndex ? "bg-emerald-50 text-emerald-950" : "text-zinc-800 hover:bg-zinc-50"}`}
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0"><span className="block truncate font-semibold">{user.fullName}</span><span className="block truncate text-xs text-zinc-500">{user.email} · {t(ROLE_LABEL_KEYS[user.role])}</span></span>
                    {value?.id === user.id ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" /> : null}
                  </span>
                </div>
              ))}
            </>
          ) : null}
          </div>
          {statusKey ? (
            <p
              role="status"
              aria-live="polite"
              className={`px-4 py-3 text-sm ${searchState.status === "error" ? "text-red-700" : "text-zinc-500"}`}
            >
              {t(statusKey)}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

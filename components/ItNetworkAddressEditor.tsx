"use client";

import { Plus, Trash2 } from "lucide-react";

import { useAppSettings } from "@/components/AppSettingsProvider";
import type { ItNetworkAddressInput } from "@/lib/it-inventory";

export default function ItNetworkAddressEditor({
  value,
  onChange,
}: {
  value: ItNetworkAddressInput[];
  onChange(value: ItNetworkAddressInput[]): void;
}) {
  const { t } = useAppSettings();

  function updateAddress(
    index: number,
    field: keyof ItNetworkAddressInput,
    nextValue: string,
  ) {
    onChange(value.map((address, addressIndex) =>
      addressIndex === index ? { ...address, [field]: nextValue } : address,
    ));
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5">
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="font-semibold text-zinc-900">{t("it.networkAddresses")}</h3>
          <p className="mt-1 max-w-md text-xs leading-5 text-zinc-500">
            {t("it.networkAddressesHint")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange([...value, { deviceLabel: "", ipAddress: "", macAddress: "" }])}
          className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 text-sm font-semibold text-emerald-800 transition hover:border-emerald-400 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-100 sm:w-auto"
        >
          <Plus className="h-4 w-4" />
          {t("it.addAddress")}
        </button>
      </div>

      {value.length > 0 ? (
        <div className="mt-4 space-y-3">
          {value.map((address, index) => (
            <div key={index} className="min-w-0 rounded-xl border border-zinc-200 bg-zinc-50/80 p-3 sm:p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-emerald-100 px-2 text-xs font-bold text-emerald-800">
                  {index + 1}
                </span>
                <button
                  type="button"
                  aria-label={t("it.removeAddress")}
                  title={t("it.removeAddress")}
                  onClick={() => onChange(value.filter((_, addressIndex) => addressIndex !== index))}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-rose-600 transition hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-rose-100"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3">
                <AddressField
                  label={t("it.deviceLabel")}
                  value={address.deviceLabel ?? ""}
                  onChange={(nextValue) => updateAddress(index, "deviceLabel", nextValue)}
                />
                <AddressField
                  label={t("it.ipAddress")}
                  value={address.ipAddress ?? ""}
                  onChange={(nextValue) => updateAddress(index, "ipAddress", nextValue)}
                />
                <AddressField
                  label={t("it.macAddress")}
                  value={address.macAddress ?? ""}
                  onChange={(nextValue) => updateAddress(index, "macAddress", nextValue)}
                />
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function AddressField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
}) {
  return (
    <label className="block min-w-0 text-sm">
      <span className="mb-1.5 block text-xs font-medium text-zinc-500">{label}</span>
      <input
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full min-w-0 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-50"
      />
    </label>
  );
}

"use client";
import { useAppSettings } from "@/components/AppSettingsProvider";
import type { PassportFileDto } from "@/lib/contracts/room-passports";
export default function PassportFileLinks({ file }: { file: PassportFileDto }) {
  const { t } = useAppSettings();
  return <div className="space-y-3">
    <p className="break-all text-sm text-zinc-600">{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</p>
    <div className="flex flex-wrap gap-3">
      <a href={file.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-xl bg-[#002060] px-4 text-sm font-semibold text-white">{t("passport.view")}</a>
      <a href={`${file.url}&download=1`} className="inline-flex min-h-11 items-center rounded-xl border border-zinc-200 px-4 text-sm font-semibold text-zinc-800">{t("passport.download")}</a>
    </div>
  </div>;
}

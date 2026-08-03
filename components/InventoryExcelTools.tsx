"use client";

import { useRef, useState } from "react";
import { FileSpreadsheet, Upload } from "lucide-react";
import { useRouter } from "next/navigation";

import { useAppSettings } from "@/components/AppSettingsProvider";
import type { InventoryExcelPreviewDto, InventoryExcelValidationError } from "@/lib/contracts/inventory-excel";
import type { TranslationKey } from "@/lib/i18n";

export default function InventoryExcelTools({
  summaryLabel = "excel.title",
}: {
  summaryLabel?: TranslationKey;
}) {
  const { t } = useAppSettings();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<InventoryExcelPreviewDto | null>(null);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const [message, setMessage] = useState("");

  async function sendFile(action: "preview" | "import") {
    if (!file || busy) return;
    setBusy(action);
    setMessage("");
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch(`/api/inventory/excel?action=${action}`, {
        method: "POST",
        body: formData,
      });
      const body = (await response.json()) as {
        preview?: InventoryExcelPreviewDto;
        importedCount?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "excel_unavailable");
      if (action === "preview" && body.preview) {
        setPreview(body.preview);
        setMessage(body.preview.errors.length ? t("excel.previewHasErrors") : t("excel.previewReady"));
      }
      if (action === "import" && typeof body.importedCount === "number") {
        setMessage(t("excel.imported", { count: body.importedCount }));
        setPreview(null);
        setFile(null);
        if (fileInput.current) fileInput.current.value = "";
        router.refresh();
      }
    } catch {
      setMessage(t("excel.requestFailed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <details className="rounded-2xl border border-emerald-100 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 font-semibold text-zinc-800">
        <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
        {t(summaryLabel)}
      </summary>
      <div className="border-t border-emerald-100 p-5">
        <a href="/api/inventory/excel?action=template" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-semibold text-emerald-700">{t("excel.template")}</a>

        <div className="mt-5 rounded-xl bg-slate-50 p-4">
          <label className="block text-sm font-medium text-zinc-700" htmlFor="inventory-excel-file">
            {t("excel.importFile")}
          </label>
          <input
            ref={fileInput}
            id="inventory-excel-file"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setPreview(null);
              setMessage("");
            }}
            className="mt-2 block w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:px-3 file:py-2 file:font-semibold file:text-emerald-700"
          />
          <p className="mt-2 text-xs text-zinc-500">{t("excel.importHint")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void sendFile("preview")}
              disabled={!file || busy !== null}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 text-sm font-semibold text-emerald-700 disabled:opacity-50"
            >
              <FileSpreadsheet className="h-4 w-4" />
              {busy === "preview" ? t("excel.checking") : t("excel.preview")}
            </button>
            {preview && preview.errors.length === 0 && preview.validRowCount > 0 ? (
              <button
                type="button"
                onClick={() => void sendFile("import")}
                disabled={busy !== null}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                <Upload className="h-4 w-4" />
                {busy === "import" ? t("excel.importing") : t("excel.import", { count: preview.validRowCount })}
              </button>
            ) : null}
          </div>
          {message ? <p role="status" className="mt-3 text-sm text-zinc-600">{message}</p> : null}
        </div>

        {preview ? (
          <div className="mt-5 overflow-hidden rounded-xl border border-black/5">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase text-zinc-500">
                  <tr><th className="px-3 py-2">#</th><th className="px-3 py-2">{t("items.name")}</th><th className="px-3 py-2">{t("items.type")}</th><th className="px-3 py-2">{t("items.object")}</th><th className="px-3 py-2">{t("itemDetails.room")}</th></tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 20).map((row) => (
                    <tr key={row.rowNumber} className="border-t border-black/5">
                      <td className="px-3 py-2 text-zinc-400">{row.rowNumber}</td>
                      <td className="px-3 py-2 font-medium text-zinc-800">{row.name || "—"}</td>
                      <td className="px-3 py-2 text-zinc-600">{row.itemType || "—"}</td>
                      <td className="px-3 py-2 text-zinc-600">{row.building || "—"}</td>
                      <td className="px-3 py-2 text-zinc-600">{row.room || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.rows.length > 20 ? <p className="border-t border-black/5 px-3 py-2 text-xs text-zinc-500">{t("excel.previewLimited", { count: preview.rows.length })}</p> : null}
          </div>
        ) : null}
        {preview?.errors.length ? (
          <ul className="mt-4 space-y-2" aria-label={t("excel.validationErrors")}>
            {preview.errors.slice(0, 50).map((error, index) => (
              <li key={`${error.rowNumber}-${error.field}-${index}`} className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {t("excel.errorAt", { row: error.rowNumber, field: error.field, message: t(errorMessageKey(error)) })}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}

function errorMessageKey(error: InventoryExcelValidationError): TranslationKey {
  const keys: Record<InventoryExcelValidationError["code"], TranslationKey> = {
    missing_headers: "excel.errorMissingHeaders",
    required: "excel.errorRequired",
    too_long: "excel.errorTooLong",
    invalid_quantity: "excel.errorQuantity",
    invalid_price: "excel.errorPrice",
    room_not_found: "excel.errorRoom",
    duplicate_inventory_number: "excel.errorDuplicate",
    formula_not_allowed: "excel.errorFormula",
    too_many_rows: "excel.errorTooMany",
  };
  return keys[error.code];
}

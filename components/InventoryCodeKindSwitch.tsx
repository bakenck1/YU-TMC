import { Barcode, QrCode } from "lucide-react";
import { useAppSettings } from "./AppSettingsProvider";

export type InventoryCodeKind = "barcode" | "qr";

export interface InventoryCodeKindSwitchProps {
  value: InventoryCodeKind;
  onChange(value: InventoryCodeKind): void;
}

export default function InventoryCodeKindSwitch({ value, onChange }: InventoryCodeKindSwitchProps) {
  const { t } = useAppSettings();
  return (
    <div className="grid grid-cols-2 gap-2 rounded-xl bg-zinc-100 p-1" aria-label={t("code.format")}>
      <button type="button" onClick={() => onChange("barcode")} aria-pressed={value === "barcode"} className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 font-semibold ${value === "barcode" ? "bg-white text-emerald-700 shadow-sm" : "text-zinc-500"}`}>
        <Barcode className="h-4 w-4" aria-hidden="true" /> {t("itemDetails.barcode")}
      </button>
      <button type="button" onClick={() => onChange("qr")} aria-pressed={value === "qr"} className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 font-semibold ${value === "qr" ? "bg-white text-emerald-700 shadow-sm" : "text-zinc-500"}`}>
        <QrCode className="h-4 w-4" aria-hidden="true" /> QR
      </button>
    </div>
  );
}

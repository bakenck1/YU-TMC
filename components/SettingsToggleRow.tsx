import Switch from "./Switch";

export interface SettingsToggleRowProps {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export default function SettingsToggleRow({ label, hint, checked, onChange }: SettingsToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div><p className="text-sm text-zinc-700">{label}</p><p className="text-xs text-zinc-400">{hint}</p></div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

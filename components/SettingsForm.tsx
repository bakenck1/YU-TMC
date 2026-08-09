"use client";

import { useState } from "react";

const LANGUAGE_OPTIONS = [
  { value: "ru", label: "Русский" },
  { value: "kk", label: "Қазақша" },
  { value: "en", label: "English" },
] as const;

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? "bg-accent" : "bg-zinc-200"
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export default function SettingsForm() {
  const [orgName, setOrgName] = useState("Университет");
  const [language, setLanguage] = useState("ru");
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [pushNotifications, setPushNotifications] = useState(false);
  const [maintenanceAlerts, setMaintenanceAlerts] = useState(true);

  return (
    <form
      onSubmit={(e) => e.preventDefault()}
      className="max-w-2xl space-y-6 rounded-2xl border border-black/5 bg-white p-6"
    >
      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">
          Название организации
        </label>
        <input
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          className="w-full rounded-xl border border-black/10 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-zinc-700">
          Язык интерфейса
        </label>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="w-full rounded-xl border border-black/10 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-accent"
        >
          {LANGUAGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-4 border-t border-black/5 pt-4">
        <p className="text-sm font-medium text-zinc-700">Уведомления</p>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-zinc-700">Email-уведомления</p>
            <p className="text-xs text-zinc-400">Отчёты и важные события на почту</p>
          </div>
          <Toggle checked={emailNotifications} onChange={setEmailNotifications} />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-zinc-700">Push-уведомления</p>
            <p className="text-xs text-zinc-400">Мгновенные оповещения в браузере</p>
          </div>
          <Toggle checked={pushNotifications} onChange={setPushNotifications} />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-zinc-700">Оповещения об обслуживании</p>
            <p className="text-xs text-zinc-400">Когда ТМЦ требует внимания</p>
          </div>
          <Toggle checked={maintenanceAlerts} onChange={setMaintenanceAlerts} />
        </div>
      </div>

      <div className="border-t border-black/5 pt-4">
        <button
          type="submit"
          className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dark"
        >
          Сохранить изменения
        </button>
      </div>
    </form>
  );
}

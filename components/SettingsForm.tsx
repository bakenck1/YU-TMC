"use client";

import { useState } from "react";
import Button from "./Button";
import SelectField from "./SelectField";
import SettingsToggleRow from "./SettingsToggleRow";
import TextField from "./TextField";

const LANGUAGE_OPTIONS = [
  { value: "ru", label: "Русский" },
  { value: "kk", label: "Қазақша" },
  { value: "en", label: "English" },
] as const;

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
      <TextField label="Название организации" value={orgName} onChange={(event) => setOrgName(event.target.value)} variant="muted" />

      <SelectField label="Язык интерфейса" fieldSize="lg" value={language} onChange={(event) => setLanguage(event.target.value)} options={LANGUAGE_OPTIONS} />

      <div className="space-y-4 border-t border-black/5 pt-4">
        <p className="text-sm font-medium text-zinc-700">Уведомления</p>

        <SettingsToggleRow label="Email-уведомления" hint="Отчёты и важные события на почту" checked={emailNotifications} onChange={setEmailNotifications} />

        <SettingsToggleRow label="Push-уведомления" hint="Мгновенные оповещения в браузере" checked={pushNotifications} onChange={setPushNotifications} />

        <SettingsToggleRow label="Оповещения об обслуживании" hint="Когда ТМЦ требует внимания" checked={maintenanceAlerts} onChange={setMaintenanceAlerts} />
      </div>

      <div className="border-t border-black/5 pt-4">
        <Button type="submit" variant="primary">Сохранить изменения</Button>
      </div>
    </form>
  );
}

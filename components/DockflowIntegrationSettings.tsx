"use client";

import { useEffect, useState } from "react";
import { KeyRound, ShieldOff } from "lucide-react";

import type {
  DockflowApiKeyMetadata,
  DockflowAuditSettings,
} from "@/lib/contracts/dockflow";
import Button from "@/components/Button";
import CheckboxField from "@/components/CheckboxField";
import TextField from "@/components/TextField";

const KEY_ENDPOINT = "/api/admin/integrations/dockflow/key";

export default function DockflowIntegrationSettings() {
  const [keys, setKeys] = useState<DockflowApiKeyMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retentionDays, setRetentionDays] = useState("90");
  const [includeKeyPrefix, setIncludeKeyPrefix] = useState(true);
  const [auditSaving, setAuditSaving] = useState(false);
  const active = keys.find((key) => key.status === "active") ?? null;

  useEffect(() => {
    let current = true;
    void fetch(KEY_ENDPOINT, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить состояние интеграции");
        return response.json() as Promise<{
          keys: DockflowApiKeyMetadata[];
          auditSettings: DockflowAuditSettings;
        }>;
      })
      .then((payload) => {
        if (current) {
          setKeys(payload.keys);
          setRetentionDays(String(payload.auditSettings.retentionDays));
          setIncludeKeyPrefix(payload.auditSettings.includeKeyPrefix);
        }
      })
      .catch((cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : "Интеграция недоступна");
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, []);

  async function revoke() {
    setRevoking(true);
    setError(null);
    try {
      const response = await fetch(KEY_ENDPOINT, { method: "DELETE" });
      if (!response.ok) throw new Error("Не удалось отозвать ключ");
      const revokedAt = new Date().toISOString();
      setKeys((current) => current.map((key) =>
        key.status === "active" ? { ...key, status: "revoked", revokedAt } : key,
      ));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось отозвать ключ");
    } finally {
      setRevoking(false);
    }
  }

  async function saveAuditSettings() {
    const days = Number(retentionDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      setError("Срок хранения должен быть целым числом от 1 до 3650 дней");
      return;
    }
    setAuditSaving(true);
    setError(null);
    try {
      const response = await fetch(KEY_ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retentionDays: days, includeKeyPrefix }),
      });
      const payload = await response.json() as {
        auditSettings?: DockflowAuditSettings;
        error?: { message?: string };
      };
      if (!response.ok || !payload.auditSettings) {
        throw new Error(payload.error?.message ?? "Не удалось сохранить настройки журнала");
      }
      setRetentionDays(String(payload.auditSettings.retentionDays));
      setIncludeKeyPrefix(payload.auditSettings.includeKeyPrefix);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить настройки журнала");
    } finally {
      setAuditSaving(false);
    }
  }

  return (
    <section className="max-w-2xl space-y-5 rounded-2xl border border-black/5 bg-white p-6">
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-emerald-50 p-2.5 text-emerald-700"><KeyRound className="h-5 w-5" /></span>
        <div>
          <h2 className="font-semibold text-zinc-900">API-интеграции → Докфлоу</h2>
          <p className="mt-1 text-sm leading-5 text-zinc-500">Ключ дает доступ только к read-only проверке обязательств сотрудника.</p>
        </div>
      </div>

      {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

      <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm leading-5 text-sky-900">
        Исходный ключ создаётся и хранится только в секрет-хранилище backend Докфлоу.
        YU Inventory получает только SHA-256-хеш; здесь отображаются только безопасные
        метаданные, а сам ключ недоступен даже администратору приложения.
      </div>

      <div className="rounded-xl bg-zinc-50 p-4 text-sm">
        {loading ? <p className="text-zinc-500">Загрузка…</p> : active ? (
          <dl className="grid gap-2 sm:grid-cols-2">
            <div><dt className="text-xs text-zinc-400">Префикс</dt><dd className="mt-1 font-mono text-zinc-800">{active.keyPrefix}…</dd></div>
            <div><dt className="text-xs text-zinc-400">Статус</dt><dd className="mt-1 font-medium text-emerald-700">Активен</dd></div>
            <div><dt className="text-xs text-zinc-400">Создан</dt><dd className="mt-1 text-zinc-700">{new Date(active.createdAt).toLocaleString("ru-RU")}</dd></div>
            <div><dt className="text-xs text-zinc-400">Последнее использование</dt><dd className="mt-1 text-zinc-700">{active.lastUsedAt ? new Date(active.lastUsedAt).toLocaleString("ru-RU") : "Еще не использовался"}</dd></div>
          </dl>
        ) : <p className="text-zinc-500">Действующий ключ не выпущен.</p>}
      </div>

      <div className="flex flex-wrap gap-3">
        {active ? <Button loading={revoking} onClick={() => void revoke()}><ShieldOff className="h-4 w-4" />Отозвать</Button> : null}
      </div>

      <div className="space-y-4 border-t border-black/5 pt-5">
        <h3 className="text-sm font-semibold text-zinc-800">Журнал обращений</h3>
        <TextField
          type="number"
          min={1}
          max={3650}
          step={1}
          label="Срок хранения, дней"
          hint="Устаревшие записи автоматически удаляются при следующем обращении Докфлоу."
          value={retentionDays}
          onChange={(event) => setRetentionDays(event.target.value)}
        />
        <CheckboxField
          label="Сохранять префикс ключа"
          hint="Если выключено, для ключей из базы журнал хранит только внутренний ID интеграции."
          checked={includeKeyPrefix}
          onChange={(event) => setIncludeKeyPrefix(event.target.checked)}
        />
        <Button loading={auditSaving} onClick={() => void saveAuditSettings()}>
          Сохранить настройки журнала
        </Button>
      </div>
    </section>
  );
}

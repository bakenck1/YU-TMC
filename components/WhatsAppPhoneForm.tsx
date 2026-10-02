"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Button from "./Button";
import TextField from "./TextField";
import { useAuth } from "./AuthProvider";

export default function WhatsAppPhoneForm() {
  const router = useRouter();
  const { logout } = useAuth();
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/whatsapp-phone", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401) { router.replace("/login"); return; }
        const messages: Record<string, string> = {
          invalid_phone: "Введите номер Казахстана: +7 и ещё 10 цифр.",
          whatsapp_not_registered: "На этом номере нет WhatsApp. Укажите номер, подключённый к WhatsApp.",
          whatsapp_check_unavailable: "Проверка WhatsApp временно недоступна. Попробуйте позже — номер пока не сохранён.",
          too_many_requests: "Слишком много попыток. Подождите и попробуйте снова.",
          whatsapp_phone_already_set: "Номер уже сохранён. Обновите страницу.",
        };
        setError(messages[result.error] ?? "Не удалось сохранить номер. Попробуйте ещё раз.");
        return;
      }
      setPhone("");
      window.location.replace(result.redirectTo);
    } catch {
      setError("Не удалось подключиться к серверу. Проверьте соединение и попробуйте снова.");
    } finally { setBusy(false); }
  }

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try { await logout(); router.replace("/login"); router.refresh(); }
    catch { setError("Не удалось выйти. Попробуйте ещё раз."); }
    finally { setBusy(false); }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <section className="w-full max-w-md rounded-3xl border border-black/5 bg-white p-6 shadow-sm sm:p-8">
        <p className="mb-3 text-sm font-semibold text-[#06458a]">YU Inventory</p>
        <h1 className="text-2xl font-bold text-zinc-900">Укажите номер WhatsApp</h1>
        <p className="mt-3 text-sm text-zinc-600">Напишите номер телефона для получения уведомлений WhatsApp. Чтобы продолжить работу в системе, сохраните свой номер.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <TextField id="whatsapp-phone" label="Ваш номер WhatsApp" type="tel" inputMode="tel" autoComplete="tel" placeholder="+7 ___ ___ __ __" required maxLength={32} value={phone} disabled={busy} onChange={(event) => setPhone(event.target.value)} />
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <Button type="submit" disabled={busy || !phone.trim()}>{busy ? "Проверяем…" : "Сохранить и продолжить"}</Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={signOut}>Выйти</Button>
        </form>
      </section>
    </main>
  );
}

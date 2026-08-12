"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  LoaderCircle,
  Mail,
} from "lucide-react";
import { useAppSettings } from "@/components/AppSettingsProvider";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordForm() {
  const { t } = useAppSettings();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setFieldError(t("auth.emailRequired"));
      return;
    }
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setFieldError(t("auth.emailInvalid"));
      return;
    }

    setFieldError(null);
    setEmail(normalizedEmail);
    setLoading(true);
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        setError(
          body.error === "too_many_reset_requests"
            ? t("auth.tooManyAttempts")
            : body.error === "password_reset_not_configured"
              ? t("auth.resetUnavailable")
              : body.error === "password_reset_delivery_failed"
                ? t("auth.resetDeliveryFailed")
                : t("auth.connectionError"),
        );
        return;
      }
      setSent(true);
    } catch {
      setError(`${t("auth.connectionError")}. ${t("auth.tryAgain")}.`);
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
          <CheckCircle2 className="h-7 w-7" />
        </div>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight text-zinc-950">
          {t("auth.resetSent")}
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-500">
          {t("auth.resetSentHint")}
        </p>
        <Link
          href={`/reset-password?email=${encodeURIComponent(email.trim())}`}
          className="mt-8 flex h-12 w-full items-center justify-center rounded-2xl bg-accent text-sm font-semibold text-white transition hover:bg-accent-dark"
        >
          {t("auth.updatePassword")}
        </Link>
        <Link
          href="/login"
          className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("auth.backToLogin")}
        </Link>
      </div>
    );
  }

  return (
    <div>
      <Link
        href="/login"
        className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("auth.backToLogin")}
      </Link>
      <h1 className="mt-7 text-3xl font-semibold tracking-tight text-zinc-950 sm:text-4xl">
        {t("auth.forgotTitle")}
      </h1>
      <p className="mt-3 text-sm leading-6 text-zinc-500">
        {t("auth.forgotSubtitle")}
      </p>

      <form className="mt-9 space-y-5" onSubmit={handleSubmit} noValidate>
        {error ? (
          <div
            className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            role="alert"
          >
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-zinc-800">
            {t("auth.email")}
          </span>
          <span className="relative block">
            <Mail className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400" />
            <input
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setFieldError(null);
              }}
              autoComplete="email"
              inputMode="email"
              disabled={loading}
              aria-invalid={Boolean(fieldError)}
              aria-describedby={fieldError ? "forgot-email-error" : undefined}
              placeholder={t("auth.emailPlaceholder")}
              className={`h-13 w-full rounded-2xl border bg-white pl-12 pr-4 text-[15px] text-zinc-900 outline-none transition placeholder:text-zinc-400 ${
                fieldError
                  ? "border-red-400 focus:ring-4 focus:ring-red-100"
                  : "border-zinc-200 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
              }`}
            />
          </span>
          {fieldError ? (
            <span id="forgot-email-error" className="mt-1.5 block text-xs text-red-600">
              {fieldError}
            </span>
          ) : null}
        </label>

        <button
          type="submit"
          disabled={loading}
          className="flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-accent px-5 text-sm font-semibold text-white transition hover:bg-accent-dark focus:outline-none focus:ring-4 focus:ring-emerald-200 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? <LoaderCircle className="h-5 w-5 animate-spin" /> : null}
          {loading ? t("auth.sendingReset") : t("auth.sendReset")}
        </button>
      </form>
    </div>
  );
}



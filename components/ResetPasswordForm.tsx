"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Mail,
} from "lucide-react";
import { useAppSettings } from "@/components/AppSettingsProvider";

interface ResetPasswordFormProps {
  initialEmail?: string;
}

interface ResetErrors {
  email?: string;
  code?: string;
  password?: string;
  confirmation?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ResetPasswordForm({
  initialEmail = "",
}: ResetPasswordFormProps) {
  const { t } = useAppSettings();
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<ResetErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updated, setUpdated] = useState(false);

  function validate() {
    const next: ResetErrors = {};
    if (!email.trim()) next.email = t("auth.emailRequired");
    else if (!EMAIL_PATTERN.test(email.trim())) next.email = t("auth.emailInvalid");
    if (!/^\d{6}$/.test(code.trim())) next.code = t("auth.codeRequired");
    if (password.length < 12) next.password = t("auth.newPasswordTooShort");
    if (confirmation !== password) next.confirmation = t("auth.passwordsMismatch");
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!validate() || loading) return;

    setLoading(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          code: code.trim(),
          password,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        setFormError(
          body.error === "invalid_reset_code"
            ? t("auth.invalidResetCode")
            : body.error === "invalid_new_password"
              ? t("auth.newPasswordTooShort")
              : body.error === "too_many_reset_attempts"
                ? t("auth.tooManyAttempts")
                : t("auth.connectionError"),
        );
        return;
      }
      setUpdated(true);
    } catch {
      setFormError(`${t("auth.connectionError")}. ${t("auth.tryAgain")}.`);
    } finally {
      setLoading(false);
    }
  }

  if (updated) {
    return (
      <div className="text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
          <CheckCircle2 className="h-7 w-7" />
        </div>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight text-zinc-950">
          {t("auth.passwordUpdated")}
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-500">
          {t("auth.passwordUpdatedHint")}
        </p>
        <Link
          href="/login"
          className="mt-8 flex h-12 w-full items-center justify-center rounded-2xl bg-accent text-sm font-semibold text-white transition hover:bg-accent-dark"
        >
          {t("auth.signIn")}
        </Link>
      </div>
    );
  }

  const inputClass = (invalid: boolean) =>
    `h-12 w-full rounded-2xl border bg-white pl-12 pr-4 text-[15px] text-zinc-900 outline-none transition placeholder:text-zinc-400 ${
      invalid
        ? "border-red-400 focus:ring-4 focus:ring-red-100"
        : "border-zinc-200 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
    }`;

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
        {t("auth.resetTitle")}
      </h1>
      <p className="mt-3 text-sm leading-6 text-zinc-500">
        {t("auth.resetSubtitle")}
      </p>

      <form className="mt-8 space-y-4" onSubmit={handleSubmit} noValidate>
        {formError ? (
          <div
            className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            role="alert"
          >
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <span>{formError}</span>
          </div>
        ) : null}

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-zinc-800">
            {t("auth.email")}
          </span>
          <span className="relative block">
            <Mail className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400" />
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              className={inputClass(Boolean(errors.email))}
            />
          </span>
          {errors.email ? (
            <span className="mt-1 block text-xs text-red-600">{errors.email}</span>
          ) : null}
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-zinc-800">
            {t("auth.resetCode")}
          </span>
          <span className="relative block">
            <KeyRound className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder={t("auth.resetCodePlaceholder")}
              className={inputClass(Boolean(errors.code))}
            />
          </span>
          {errors.code ? (
            <span className="mt-1 block text-xs text-red-600">{errors.code}</span>
          ) : null}
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-zinc-800">
            {t("auth.newPassword")}
          </span>
          <span className="relative block">
            <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400" />
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              placeholder={t("auth.newPasswordPlaceholder")}
              className={`${inputClass(Boolean(errors.password))} pr-12`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((current) => !current)}
              className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
              aria-label={
                showPassword ? t("auth.hidePassword") : t("auth.showPassword")
              }
            >
              {showPassword ? (
                <EyeOff className="h-5 w-5" />
              ) : (
                <Eye className="h-5 w-5" />
              )}
            </button>
          </span>
          {errors.password ? (
            <span className="mt-1 block text-xs text-red-600">
              {errors.password}
            </span>
          ) : null}
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-zinc-800">
            {t("auth.confirmPassword")}
          </span>
          <span className="relative block">
            <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400" />
            <input
              type={showPassword ? "text" : "password"}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="new-password"
              placeholder={t("auth.confirmPasswordPlaceholder")}
              className={inputClass(Boolean(errors.confirmation))}
            />
          </span>
          {errors.confirmation ? (
            <span className="mt-1 block text-xs text-red-600">
              {errors.confirmation}
            </span>
          ) : null}
        </label>

        <button
          type="submit"
          disabled={loading}
          className="mt-2 flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-accent px-5 text-sm font-semibold text-white transition hover:bg-accent-dark focus:outline-none focus:ring-4 focus:ring-emerald-200 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? <LoaderCircle className="h-5 w-5 animate-spin" /> : null}
          {loading ? t("auth.updatingPassword") : t("auth.updatePassword")}
        </button>
      </form>
    </div>
  );
}



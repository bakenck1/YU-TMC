"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useAppSettings } from "@/components/AppSettingsProvider";
import { useAuth } from "@/components/AuthProvider";

interface FieldErrors {
  firstName?: string;
  lastName?: string;
  email?: string;
  password?: string;
  confirmation?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterForm() {
  const { t } = useAppSettings();
  const { refreshSession } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function validate() {
    const errors: FieldErrors = {};
    if (firstName.trim().length < 2) {
      errors.firstName = t("auth.firstNameRequired");
    }
    if (lastName.trim().length < 2) {
      errors.lastName = t("auth.lastNameRequired");
    }
    if (!email.trim()) errors.email = t("auth.emailRequired");
    else if (!EMAIL_PATTERN.test(email.trim())) {
      errors.email = t("auth.emailInvalid");
    }
    if (!password) errors.password = t("auth.passwordRequired");
    else if (password.length < 12) {
      errors.password = t("auth.newPasswordTooShort");
    }
    if (confirmation !== password) {
      errors.confirmation = t("auth.passwordsMismatch");
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!validate() || loading) return;

    setLoading(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          password,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        const errorKey =
          body.error === "registration_closed"
            ? "auth.registrationClosed"
            : body.error === "too_many_registration_attempts"
              ? "auth.tooManyAttempts"
              : body.error === "invalid_registration_data"
                ? "auth.registrationFailed"
                : "auth.connectionError";
        setFormError(t(errorKey));
        return;
      }

      await refreshSession();
      window.location.replace("/");
    } catch {
      setFormError(`${t("auth.connectionError")}. ${t("auth.tryAgain")}.`);
    } finally {
      setLoading(false);
    }
  }

  const inputClass = (invalid: boolean) =>
    `h-13 w-full rounded-2xl border bg-white pl-12 pr-4 text-[15px] text-zinc-900 outline-none transition placeholder:text-zinc-400 disabled:cursor-not-allowed disabled:bg-zinc-50 ${
      invalid
        ? "border-red-400 focus:ring-4 focus:ring-red-100"
        : "border-zinc-200 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
    }`;

  return (
    <div>
      <div>
        <p className="text-sm font-semibold text-emerald-700">
          {t("auth.visualTitle")}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-950 sm:text-4xl">
          {t("auth.registerTitle")}
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-500">
          {t("auth.registerSubtitle")}
        </p>
      </div>

      <form className="mt-7 space-y-4" onSubmit={handleSubmit} noValidate>
        {formError ? (
          <div
            className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            role="alert"
          >
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <span className="leading-5">{formError}</span>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-800">
              {t("auth.firstName")}
            </span>
            <span className="relative block">
              <UserRound className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400" />
              <input
                value={firstName}
                onChange={(event) => {
                  setFirstName(event.target.value);
                  setFieldErrors((current) => ({
                    ...current,
                    firstName: undefined,
                  }));
                }}
                autoComplete="given-name"
                disabled={loading}
                placeholder={t("auth.firstNamePlaceholder")}
                className={inputClass(Boolean(fieldErrors.firstName))}
              />
            </span>
            {fieldErrors.firstName ? (
              <span className="mt-1.5 block text-xs text-red-600">
                {fieldErrors.firstName}
              </span>
            ) : null}
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-800">
              {t("auth.lastName")}
            </span>
            <span className="relative block">
              <UserRound className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400" />
              <input
                value={lastName}
                onChange={(event) => {
                  setLastName(event.target.value);
                  setFieldErrors((current) => ({
                    ...current,
                    lastName: undefined,
                  }));
                }}
                autoComplete="family-name"
                disabled={loading}
                placeholder={t("auth.lastNamePlaceholder")}
                className={inputClass(Boolean(fieldErrors.lastName))}
              />
            </span>
            {fieldErrors.lastName ? (
              <span className="mt-1.5 block text-xs text-red-600">
                {fieldErrors.lastName}
              </span>
            ) : null}
          </label>
        </div>

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
                setFieldErrors((current) => ({
                  ...current,
                  email: undefined,
                }));
              }}
              autoComplete="email"
              inputMode="email"
              disabled={loading}
              placeholder={t("auth.emailPlaceholder")}
              className={inputClass(Boolean(fieldErrors.email))}
            />
          </span>
          {fieldErrors.email ? (
            <span className="mt-1.5 block text-xs text-red-600">
              {fieldErrors.email}
            </span>
          ) : null}
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-800">
              {t("auth.password")}
            </span>
            <span className="relative block">
              <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400" />
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setFieldErrors((current) => ({
                    ...current,
                    password: undefined,
                  }));
                }}
                autoComplete="new-password"
                disabled={loading}
                placeholder={t("auth.newPasswordPlaceholder")}
                className={`${inputClass(Boolean(fieldErrors.password))} pr-12`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
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
            {fieldErrors.password ? (
              <span className="mt-1.5 block text-xs text-red-600">
                {fieldErrors.password}
              </span>
            ) : null}
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-800">
              {t("auth.confirmPassword")}
            </span>
            <span className="relative block">
              <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400" />
              <input
                type={showPassword ? "text" : "password"}
                value={confirmation}
                onChange={(event) => {
                  setConfirmation(event.target.value);
                  setFieldErrors((current) => ({
                    ...current,
                    confirmation: undefined,
                  }));
                }}
                autoComplete="new-password"
                disabled={loading}
                placeholder={t("auth.confirmPasswordPlaceholder")}
                className={inputClass(Boolean(fieldErrors.confirmation))}
              />
            </span>
            {fieldErrors.confirmation ? (
              <span className="mt-1.5 block text-xs text-red-600">
                {fieldErrors.confirmation}
              </span>
            ) : null}
          </label>
        </div>

        <div className="flex items-start gap-3 rounded-2xl bg-emerald-50 px-4 py-3 text-xs leading-5 text-emerald-800">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
          <span>{t("auth.registrationSecurity")}</span>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-accent px-5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(22,163,74,0.20)] transition hover:bg-accent-dark focus:outline-none focus:ring-4 focus:ring-emerald-200 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? <LoaderCircle className="h-5 w-5 animate-spin" /> : null}
          {loading ? t("auth.creatingAccount") : t("auth.createAccount")}
        </button>

        <p className="text-center text-sm text-zinc-500">
          {t("auth.alreadyHaveAccount")}{" "}
          <Link
            href="/login"
            className="font-semibold text-emerald-700 hover:text-emerald-800 hover:underline"
          >
            {t("auth.signIn")}
          </Link>
        </p>
      </form>
    </div>
  );
}

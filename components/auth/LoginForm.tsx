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
} from "lucide-react";
import { useAppSettings } from "@/components/AppSettingsProvider";
import { useAuth } from "@/components/AuthProvider";
import {
  canAccessPath,
  defaultPathForRole,
  isSafeReturnPath,
} from "@/lib/security/authorization";

interface LoginFormProps {
  returnTo?: string;
  registrationAvailable?: boolean;
}

interface FieldErrors {
  email?: string;
  password?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginForm({
  returnTo,
  registrationAvailable = false,
}: LoginFormProps) {
  const { t } = useAppSettings();
  const { refreshSession } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function validate() {
    const errors: FieldErrors = {};
    const normalizedEmail = email.trim();
    if (!normalizedEmail) errors.email = t("auth.emailRequired");
    else if (!EMAIL_PATTERN.test(normalizedEmail)) {
      errors.email = t("auth.emailInvalid");
    }

    if (!password) errors.password = t("auth.passwordRequired");
    else if (password.length < 8) {
      errors.password = t("auth.passwordTooShort");
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
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          email: email.trim(),
          password,
          rememberMe,
        }),
      });

      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        const errorKey =
          body.error === "user_blocked"
            ? "auth.userBlocked"
            : body.error === "too_many_login_attempts"
              ? "auth.tooManyAttempts"
              : body.error === "authentication_not_configured"
                ? "auth.notConfigured"
                : response.status === 401
                  ? "auth.invalidCredentials"
                  : "auth.connectionError";
        setFormError(t(errorKey));
        return;
      }

      const user = await refreshSession();
      const requestedPath = isSafeReturnPath(returnTo) ? returnTo! : null;
      const destination =
        user && requestedPath && canAccessPath(user.role, requestedPath)
          ? requestedPath
          : user
            ? defaultPathForRole(user.role)
            : "/";
      window.location.replace(destination);
    } catch {
      setFormError(`${t("auth.connectionError")}. ${t("auth.tryAgain")}.`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div>
        <p className="text-sm font-semibold text-emerald-700">
          {t("auth.visualTitle")}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-950 sm:text-4xl">
          {t("auth.loginTitle")}
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-500">
          {t("auth.loginSubtitle")}
        </p>
      </div>

      <form className="mt-9 space-y-5" onSubmit={handleSubmit} noValidate>
        {formError ? (
          <div
            className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            role="alert"
          >
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <span className="leading-5">{formError}</span>
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
                if (fieldErrors.email) {
                  setFieldErrors((current) => ({ ...current, email: undefined }));
                }
              }}
              autoComplete="username"
              inputMode="email"
              disabled={loading}
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? "login-email-error" : undefined}
              placeholder={t("auth.emailPlaceholder")}
              className={`h-13 w-full rounded-2xl border bg-white pl-12 pr-4 text-[15px] text-zinc-900 outline-none transition placeholder:text-zinc-400 disabled:cursor-not-allowed disabled:bg-zinc-50 ${
                fieldErrors.email
                  ? "border-red-400 focus:ring-4 focus:ring-red-100"
                  : "border-zinc-200 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
              }`}
            />
          </span>
          {fieldErrors.email ? (
            <span
              id="login-email-error"
              className="mt-1.5 block text-xs text-red-600"
            >
              {fieldErrors.email}
            </span>
          ) : null}
        </label>

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
                if (fieldErrors.password) {
                  setFieldErrors((current) => ({
                    ...current,
                    password: undefined,
                  }));
                }
              }}
              autoComplete="current-password"
              disabled={loading}
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={
                fieldErrors.password ? "login-password-error" : undefined
              }
              placeholder={t("auth.passwordPlaceholder")}
              className={`h-13 w-full rounded-2xl border bg-white pl-12 pr-12 text-[15px] text-zinc-900 outline-none transition placeholder:text-zinc-400 disabled:cursor-not-allowed disabled:bg-zinc-50 ${
                fieldErrors.password
                  ? "border-red-400 focus:ring-4 focus:ring-red-100"
                  : "border-zinc-200 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
              }`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((current) => !current)}
              disabled={loading}
              className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
            <span
              id="login-password-error"
              className="mt-1.5 block text-xs text-red-600"
            >
              {fieldErrors.password}
            </span>
          ) : null}
        </label>

        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-zinc-600">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(event) => setRememberMe(event.target.checked)}
              disabled={loading}
              className="h-4 w-4 rounded border-zinc-300 accent-emerald-600"
            />
            <span>{t("auth.rememberMe")}</span>
          </label>
          <Link
            href="/forgot-password"
            className="text-sm font-semibold text-emerald-700 transition hover:text-emerald-800 hover:underline"
          >
            {t("auth.forgotPassword")}
          </Link>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-accent px-5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(22,163,74,0.20)] transition hover:bg-accent-dark focus:outline-none focus:ring-4 focus:ring-emerald-200 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? <LoaderCircle className="h-5 w-5 animate-spin" /> : null}
          {loading ? t("auth.signingIn") : t("auth.signIn")}
        </button>

        {registrationAvailable ? (
          <p className="text-center text-sm text-zinc-500">
            {t("auth.noAccount")}{" "}
            <Link
              href="/register"
              className="font-semibold text-emerald-700 transition hover:text-emerald-800 hover:underline"
            >
              {t("auth.register")}
            </Link>
          </p>
        ) : null}
      </form>
    </div>
  );
}

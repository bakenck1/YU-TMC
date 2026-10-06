"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  isAuthRole,
  type AuthenticatedUser,
} from "@/lib/security/authorization";
import { removePushSubscriptionBeforeLogout } from "@/lib/client-push-subscription";
import { clearSensitiveSearchStorage } from "@/lib/search-history";

interface AuthContextValue {
  user: AuthenticatedUser | null;
  loading: boolean;
  sessionError: boolean;
  refreshSession: () => Promise<AuthenticatedUser | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function isAuthenticatedUser(value: unknown): value is AuthenticatedUser {
  if (!value || typeof value !== "object") return false;
  const user = value as Partial<AuthenticatedUser>;
  return (
    typeof user.email === "string" &&
    typeof user.name === "string" &&
    isAuthRole(user.role)
  );
}

class SessionReadError extends Error {
  constructor(readonly retryDelay = 1000) { super("session_unavailable"); }
}

async function requestAuthenticatedUser(signal: AbortSignal) {
  const response = await fetch("/api/auth/session", {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  if (response.status === 401) return null;
  if (!response.ok) {
    const seconds = Number(response.headers.get("retry-after"));
    throw new SessionReadError(Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : 1000);
  }

  const body: unknown = await response.json();
  const candidate =
    body && typeof body === "object" && "user" in body
      ? (body as { user: unknown }).user
      : null;
  if (!isAuthenticatedUser(candidate)) throw new SessionReadError();
  return candidate;
}

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState(false);
  const [retry, setRetry] = useState({ delay: 1000, attempt: 0 });
  const attempts = useRef(0);
  const generation = useRef(0);
  const activeRequest = useRef<{ controller: AbortController; promise: Promise<AuthenticatedUser | null> } | null>(null);

  const refreshSession = useCallback(() => {
    if (activeRequest.current) return activeRequest.current.promise;
    const current = ++generation.current;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    setLoading(true);
    setSessionError(false);
    const promise = (async () => {
      try {
        const nextUser = await requestAuthenticatedUser(controller.signal);
        if (current !== generation.current) return null;
        setUser(nextUser);
        attempts.current = 0;
        return nextUser;
      } catch (error) {
        if (current !== generation.current) return null;
        // Only a definitive 401 clears the verified user. A failed connection,
        // rate limit or server error must not erase the navigation permissions.
        attempts.current++;
        setSessionError(true);
        setRetry({ attempt: attempts.current, delay: Math.max(error instanceof SessionReadError ? error.retryDelay : 1000,
          1000 * 2 ** Math.min(attempts.current - 1, 5)) });
        return null;
      } finally {
        window.clearTimeout(timeout);
        if (current === generation.current) { activeRequest.current = null; setLoading(false); }
      }
    })();
    activeRequest.current = { controller, promise };
    return promise;
  }, []);

  const cancelSessionRead = useCallback(() => {
    generation.current++;
    activeRequest.current?.controller.abort();
    activeRequest.current = null;
  }, []);

  useEffect(() => {
    void refreshSession();
    return cancelSessionRead;
  }, [cancelSessionRead, refreshSession]);

  useEffect(() => {
    if (!sessionError || retry.attempt >= 3) return;
    const timer = window.setTimeout(() => void refreshSession(), Math.min(retry.delay, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [sessionError, retry, refreshSession]);

  const logout = useCallback(async () => {
    cancelSessionRead();
    setSessionError(false);
    setLoading(false);
    await removePushSubscriptionBeforeLogout();
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error("logout_failed");
    try {
      clearSensitiveSearchStorage();
    } catch {
      // Storage can be unavailable in private browsing and embedded webviews.
    }
    setUser(null);
  }, [cancelSessionRead]);

  const value = useMemo(
    () => ({ user, loading, sessionError, refreshSession, logout }),
    [loading, logout, refreshSession, sessionError, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

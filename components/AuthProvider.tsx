"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

async function requestAuthenticatedUser() {
  const response = await fetch("/api/auth/session", {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) return null;

  const body: unknown = await response.json();
  const candidate =
    body && typeof body === "object" && "user" in body
      ? (body as { user: unknown }).user
      : null;
  return isAuthenticatedUser(candidate) ? candidate : null;
}

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    try {
      const nextUser = await requestAuthenticatedUser();
      setUser(nextUser);
      return nextUser;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    requestAuthenticatedUser()
      .then((nextUser) => {
        if (!cancelled) setUser(nextUser);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(async () => {
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
  }, []);

  const value = useMemo(
    () => ({ user, loading, refreshSession, logout }),
    [loading, logout, refreshSession, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

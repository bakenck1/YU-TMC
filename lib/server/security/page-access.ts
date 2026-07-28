import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ApplicationError } from "@/lib/domain/application-error";
import {
  canAccessPath,
  defaultPathForRole,
} from "@/lib/security/authorization";
import { SESSION_COOKIE_NAME } from "@/lib/security/session";
import { requireCurrentUserToken } from "@/lib/server/security/request-user";

export async function requireAuthenticatedPage() {
  return currentPageUser();
}

export async function requireAuthorizedPage(pathname: string) {
  const user = await currentPageUser();
  if (!canAccessPath(user.role, pathname)) {
    redirect(defaultPathForRole(user.role));
  }
  return user;
}

async function currentPageUser() {
  const cookieStore = await cookies();
  try {
    return await requireCurrentUserToken(
      cookieStore.get(SESSION_COOKIE_NAME)?.value,
    );
  } catch (error) {
    if (error instanceof ApplicationError && error.kind === "unauthorized") {
      redirect("/login");
    }
    throw error;
  }
}

import "server-only";

import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import { sessionFromRequest } from "@/lib/security/session";
import { verifySessionToken } from "@/lib/security/session";

export async function requireCurrentUser(request: Request) {
  const session = sessionFromRequest(request);
  if (!session) {
    throw new ApplicationError("unauthorized", "unauthorized");
  }
  return requireSessionSubject(session.sub);
}

export async function requireCurrentUserToken(token: string | undefined) {
  const user = await resolveCurrentUserToken(token);
  if (!user) {
    throw new ApplicationError("unauthorized", "unauthorized");
  }
  return user;
}

export async function resolveCurrentUserToken(token: string | undefined) {
  const session = token ? verifySessionToken(token) : null;
  if (!session) return null;
  return resolveSessionSubject(session.sub);
}

async function requireSessionSubject(subject: string) {
  const user = await resolveSessionSubject(subject);
  if (!user) {
    throw new ApplicationError("unauthorized", "unauthorized");
  }
  return user;
}

async function resolveSessionSubject(subject: string) {
  let user;
  try {
    user = await getApplicationServices().users.resolveSessionSubject(subject);
  } catch (error) {
    throw new ApplicationError("unavailable", "authentication_unavailable", {
      cause: error,
    });
  }
  return user;
}

export async function requireUserAdministrator(request: Request) {
  const user = await requireCurrentUser(request);
  if (user.role !== "admin" && user.role !== "owner") {
    throw new ApplicationError("forbidden", "forbidden");
  }
  return user;
}

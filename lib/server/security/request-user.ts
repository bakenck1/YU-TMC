import "server-only";

import { ApplicationError } from "@/lib/domain/application-error";
import { getApplicationServices } from "@/lib/server/application";
import {
  hasPermission,
  type AppPermission,
  type AuthorizationActor,
} from "@/lib/security/permissions";
import { sessionFromRequest } from "@/lib/security/session";
import { verifySessionToken } from "@/lib/security/session";
import { consumeApiRateLimit } from "@/lib/security/rate-limiter";
import { requireSameOriginMutation } from "@/lib/security/request-integrity";

export async function requireCurrentUser(request: Request) {
  requireSameOriginMutation(request);
  const limit = consumeApiRateLimit(request);
  if (!limit.allowed) {
    throw new ApplicationError("rate_limited", "too_many_requests", {
      safeDetails: { retryAfterSeconds: String(limit.retryAfterSeconds) },
    });
  }
  const session = sessionFromRequest(request);
  if (!session) {
    throw new ApplicationError("unauthorized", "unauthorized");
  }
  return requireSessionSubject(session.sub, session.ver);
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
  return resolveSessionSubject(session.sub, session.ver);
}

async function requireSessionSubject(subject: string, sessionVersion: number) {
  const user = await resolveSessionSubject(subject, sessionVersion);
  if (!user) {
    throw new ApplicationError("unauthorized", "unauthorized");
  }
  return user;
}

async function resolveSessionSubject(subject: string, sessionVersion: number) {
  let user;
  try {
    user = await getApplicationServices().users.resolveCurrentAccount(subject);
  } catch (error) {
    throw new ApplicationError("unavailable", "authentication_unavailable", {
      cause: error,
    });
  }
  return user?.sessionVersion === sessionVersion ? user : null;
}

export async function requirePermission(
  request: Request,
  permission: AppPermission,
) {
  const user = await requireCurrentUser(request);
  if (!hasPermission(user.role, permission)) {
    throw new ApplicationError("forbidden", "forbidden");
  }
  return user;
}

export function authorizationActor(user: {
  userId: string;
  role: AuthorizationActor["role"];
}): AuthorizationActor {
  return { userId: user.userId, role: user.role };
}

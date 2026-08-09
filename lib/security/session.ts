import "server-only";

import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { dataDirectory } from "../data-directory";
import {
  isAuthRole,
  type AuthenticatedUser,
  type AuthRole,
} from "./authorization";
import { isSecureSecretValue } from "./secret-configuration";
import { SESSION_COOKIE_NAME } from "./session-constants";

export { SESSION_COOKIE_NAME } from "./session-constants";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;
export const REMEMBERED_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
let cachedSessionSecret: string | null = null;

function sessionSecretFile() {
  return path.join(dataDirectory(), "session-secret");
}

export interface SessionPayload {
  sub: string;
  name: string;
  role: AuthRole;
  iat: number;
  exp: number;
  jti: string;
  ver: number;
}

function sessionSecret() {
  const secret = process.env.SESSION_SECRET?.trim();
  if (isSecureSecretValue(secret, 43)) return secret;
  if (process.env.NODE_ENV === "production") return null;
  if (cachedSessionSecret) return cachedSessionSecret;

  try {
    const stored = readFileSync(sessionSecretFile(), "utf8").trim();
    if (stored.length >= 32) {
      cachedSessionSecret = stored;
      return stored;
    }
  } catch {
    // The first local launch creates a private fallback secret below.
  }

  try {
    const secretFile = sessionSecretFile();
    mkdirSync(path.dirname(secretFile), { recursive: true, mode: 0o700 });
    const generated = randomBytes(48).toString("base64url");
    writeFileSync(secretFile, generated, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    cachedSessionSecret = generated;
    return generated;
  } catch {
    try {
      const stored = readFileSync(sessionSecretFile(), "utf8").trim();
      if (stored.length >= 32) {
        cachedSessionSecret = stored;
        return stored;
      }
    } catch {
      return null;
    }
    return null;
  }
}

export function shouldUseSecureSessionCookie() {
  if (process.env.NODE_ENV === "production") return true;
  return process.env.SESSION_COOKIE_SECURE?.trim() === "true";
}

export function sessionCookieOptions(options?: {
  maxAge?: number;
  sameSite?: "strict" | "lax";
}) {
  return {
    httpOnly: true,
    secure: shouldUseSecureSessionCookie(),
    sameSite: options?.sameSite ?? ("strict" as const),
    path: "/",
    ...(options?.maxAge === undefined ? {} : { maxAge: options.maxAge }),
  };
}

export function expiredSessionCookieOptions() {
  return {
    ...sessionCookieOptions(),
    expires: new Date(0),
    maxAge: 0,
  };
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSignedServerValue(purpose: string, value: string) {
  const secret = sessionSecret();
  if (!secret) throw new Error("SESSION_SECRET must contain at least 32 characters");
  const encodedValue = Buffer.from(value).toString("base64url");
  const signedPayload = `${purpose}.${encodedValue}`;
  return `${encodedValue}.${signature(signedPayload, secret)}`;
}

export function createServerValueDigest(purpose: string, value: string) {
  const secret = sessionSecret();
  if (!secret) throw new Error("SESSION_SECRET must contain at least 43 secure characters");
  return signature(`${purpose}.${value}`, secret);
}

export function verifySignedServerValue(
  purpose: string,
  token: string,
): string | null {
  const secret = sessionSecret();
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encodedValue, receivedSignature] = parts;
  if (!encodedValue || !receivedSignature) return null;

  const expectedSignature = signature(`${purpose}.${encodedValue}`, secret);
  const receivedBuffer = Buffer.from(receivedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(receivedBuffer, expectedBuffer)
  ) {
    return null;
  }
  try {
    return Buffer.from(encodedValue, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

export function isSessionConfigured() {
  return sessionSecret() !== null;
}

export function createSessionToken(
  user: AuthenticatedUser,
  ttlSeconds = SESSION_TTL_SECONDS,
  sessionVersion = 1,
) {
  const secret = sessionSecret();
  if (!secret) throw new Error("SESSION_SECRET must contain at least 32 characters");

  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub: user.email,
    name: user.name,
    role: user.role,
    iat: now,
    exp: now + ttlSeconds,
    jti: randomUUID(),
    ver: sessionVersion,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${signature(encodedPayload, secret)}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  const secret = sessionSecret();
  if (!secret) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, receivedSignature] = parts;
  if (!encodedPayload || !receivedSignature) return null;

  const expectedSignature = signature(encodedPayload, secret);
  const receivedBuffer = Buffer.from(receivedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(receivedBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<SessionPayload>;
    const now = Math.floor(Date.now() / 1000);
    if (
      typeof payload.sub !== "string" ||
      typeof payload.name !== "string" ||
      !isAuthRole(payload.role) ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      typeof payload.jti !== "string" ||
      !Number.isSafeInteger(payload.ver) ||
      payload.ver! < 1 ||
      payload.exp <= now
    ) {
      return null;
    }
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

export function resetSessionStateForTests() {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Session state can only be reset in tests");
  }
  cachedSessionSecret = null;
}

export function sessionUser(payload: SessionPayload): AuthenticatedUser {
  return {
    email: payload.sub,
    name: payload.name,
    role: payload.role,
  };
}

export function sessionFromRequest(request: Request) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  const token = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`))
    ?.slice(SESSION_COOKIE_NAME.length + 1);

  if (!token) return null;
  try {
    return verifySessionToken(decodeURIComponent(token));
  } catch {
    return null;
  }
}

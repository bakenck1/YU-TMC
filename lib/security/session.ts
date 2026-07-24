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
import {
  isAuthRole,
  type AuthenticatedUser,
  type AuthRole,
} from "./authorization";

export const SESSION_COOKIE_NAME = "yu_inventory_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;
export const REMEMBERED_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const SESSION_SECRET_FILE = path.join(
  process.cwd(),
  ".data",
  "session-secret",
);
let cachedSessionSecret: string | null = null;

export interface SessionPayload {
  sub: string;
  name: string;
  role: AuthRole;
  iat: number;
  exp: number;
  jti: string;
}

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (cachedSessionSecret) return cachedSessionSecret;

  try {
    const stored = readFileSync(SESSION_SECRET_FILE, "utf8").trim();
    if (stored.length >= 32) {
      cachedSessionSecret = stored;
      return stored;
    }
  } catch {
    // The first local launch creates a private fallback secret below.
  }

  try {
    mkdirSync(path.dirname(SESSION_SECRET_FILE), { recursive: true });
    const generated = randomBytes(48).toString("base64url");
    writeFileSync(SESSION_SECRET_FILE, generated, {
      encoding: "utf8",
      flag: "wx",
    });
    cachedSessionSecret = generated;
    return generated;
  } catch {
    try {
      const stored = readFileSync(SESSION_SECRET_FILE, "utf8").trim();
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

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function isSessionConfigured() {
  return sessionSecret() !== null;
}

export function createSessionToken(
  user: AuthenticatedUser,
  ttlSeconds = SESSION_TTL_SECONDS,
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
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${signature(encodedPayload, secret)}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  const secret = sessionSecret();
  if (!secret) return null;

  const [encodedPayload, receivedSignature] = token.split(".");
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
      payload.exp <= now
    ) {
      return null;
    }
    return payload as SessionPayload;
  } catch {
    return null;
  }
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

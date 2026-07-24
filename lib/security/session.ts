import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "yu_inventory_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

interface SessionPayload {
  sub: string;
  iat: number;
  exp: number;
  jti: string;
}

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function isSessionConfigured() {
  return sessionSecret() !== null;
}

export function createSessionToken(email: string) {
  const secret = sessionSecret();
  if (!secret) throw new Error("SESSION_SECRET must contain at least 32 characters");

  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub: email,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
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

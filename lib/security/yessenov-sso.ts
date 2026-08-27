import "server-only";

import {
  createPublicKey,
  randomBytes,
  verify,
} from "node:crypto";
import type { JsonWebKey as CryptoJsonWebKey } from "node:crypto";

import { isSafeReturnPath } from "@/lib/security/authorization";
import { isSecureSecretValue } from "@/lib/security/secret-configuration";
import {
  createSignedServerValue,
  verifySignedServerValue,
} from "@/lib/security/session";

const YESSENOV_ISSUER = "https://id.yu.edu.kz/openid";
const YESSENOV_AUTHORIZATION_ENDPOINT = `${YESSENOV_ISSUER}/authorize`;
const YESSENOV_TOKEN_ENDPOINT = `${YESSENOV_ISSUER}/token`;
const YESSENOV_JWKS_ENDPOINT = `${YESSENOV_ISSUER}/jwks`;
const OIDC_TRANSACTION_TTL_SECONDS = 10 * 60;
const CLOCK_SKEW_SECONDS = 60;

export const YESSENOV_SSO_TRANSACTION_COOKIE =
  "yu_inventory_yessenov_transaction";
export const YESSENOV_SSO_COOKIE_PATH = "/api/auth/yessenov";
export const YESSENOV_SSO_TRANSACTION_TTL_SECONDS =
  OIDC_TRANSACTION_TTL_SECONDS;

export interface YessenovSsoConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface YessenovAuthorizationRequest {
  url: URL;
  state: string;
  nonce: string;
  returnTo: string | null;
}

export interface YessenovSsoTransaction {
  state: string;
  nonce: string;
  returnTo: string | null;
  expiresAt: number;
}

export interface YessenovIdentity {
  subject: string;
  email: string;
  name: string;
  iin: string | null;
}

interface IdTokenHeader {
  alg?: unknown;
  kid?: unknown;
}

interface IdTokenClaims {
  iss?: unknown;
  aud?: unknown;
  azp?: unknown;
  sub?: unknown;
  nonce?: unknown;
  exp?: unknown;
  iat?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  family_name?: unknown;
  given_name?: unknown;
  middle_name?: unknown;
  is_personnel?: unknown;
  iin?: unknown;
}

interface JwkSet {
  keys?: CryptoJsonWebKey[];
}

let cachedJwks:
  | { keys: CryptoJsonWebKey[]; expiresAt: number }
  | undefined;

export function yessenovSsoConfig(
  environment: NodeJS.ProcessEnv = process.env,
): YessenovSsoConfig | null {
  const clientId = environment.YESSENOV_OIDC_CLIENT_ID?.trim();
  const clientSecret = environment.YESSENOV_OIDC_CLIENT_SECRET?.trim();
  const redirectUri = environment.YESSENOV_OIDC_REDIRECT_URI?.trim();
  if (!clientId || !isSecureSecretValue(clientSecret, 24) || !redirectUri) {
    return null;
  }

  let callback: URL;
  try {
    callback = new URL(redirectUri);
  } catch {
    return null;
  }
  const localCallback = ["localhost", "127.0.0.1", "[::1]"].includes(
    callback.hostname,
  );
  if (
    (callback.protocol !== "https:" &&
      !(callback.protocol === "http:" && localCallback)) ||
    callback.username ||
    callback.password ||
    callback.search ||
    callback.hash ||
    callback.pathname !== "/api/auth/yessenov/callback"
  ) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    redirectUri: callback.toString(),
  };
}

export function isYessenovSsoConfigured(
  environment: NodeJS.ProcessEnv = process.env,
) {
  return yessenovSsoConfig(environment) !== null;
}

export function createYessenovAuthorizationRequest(
  config: YessenovSsoConfig,
  returnTo?: string | null,
): YessenovAuthorizationRequest {
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const safeReturnTo = isSafeReturnPath(returnTo) ? returnTo! : null;
  const url = new URL(YESSENOV_AUTHORIZATION_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid profile email",
    state,
    nonce,
  }).toString();
  return { url, state, nonce, returnTo: safeReturnTo };
}

export function createYessenovSsoTransactionToken(
  request: YessenovAuthorizationRequest,
  now = Math.floor(Date.now() / 1000),
) {
  const transaction: YessenovSsoTransaction = {
    state: request.state,
    nonce: request.nonce,
    returnTo: request.returnTo,
    expiresAt: now + OIDC_TRANSACTION_TTL_SECONDS,
  };
  return createSignedServerValue(
    "yessenov-sso-transaction",
    JSON.stringify(transaction),
  );
}

export function verifyYessenovSsoTransactionToken(
  token: string,
  now = Math.floor(Date.now() / 1000),
): YessenovSsoTransaction | null {
  const value = verifySignedServerValue("yessenov-sso-transaction", token);
  if (!value) return null;
  try {
    const transaction = JSON.parse(value) as Partial<YessenovSsoTransaction>;
    if (
      typeof transaction.state !== "string" ||
      transaction.state.length < 32 ||
      transaction.state.length > 256 ||
      typeof transaction.nonce !== "string" ||
      transaction.nonce.length < 32 ||
      transaction.nonce.length > 256 ||
      (transaction.returnTo !== null &&
        !isSafeReturnPath(transaction.returnTo)) ||
      typeof transaction.expiresAt !== "number" ||
      transaction.expiresAt <= now
    ) {
      return null;
    }
    return transaction as YessenovSsoTransaction;
  } catch {
    return null;
  }
}

export async function exchangeYessenovAuthorizationCode(
  config: YessenovSsoConfig,
  code: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const credentials = Buffer.from(
    `${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`,
    "utf8",
  ).toString("base64");
  const response = await fetcher(YESSENOV_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await response.json().catch(() => null)) as
    | { id_token?: unknown }
    | null;
  if (!response.ok || typeof body?.id_token !== "string") {
    throw new Error("Yessenov ID token exchange failed");
  }
  return body.id_token;
}

export async function verifyYessenovIdToken(
  idToken: string,
  input: {
    clientId: string;
    nonce: string;
    now?: number;
    fetcher?: typeof fetch;
  },
): Promise<YessenovIdentity> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Invalid Yessenov ID token");
  const [encodedHeader, encodedClaims, encodedSignature] = parts;
  if (!encodedHeader || !encodedClaims || !encodedSignature) {
    throw new Error("Invalid Yessenov ID token");
  }
  const header = decodeJson<IdTokenHeader>(encodedHeader);
  const claims = decodeJson<IdTokenClaims>(encodedClaims);
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new Error("Unsupported Yessenov ID token signature");
  }
  const jwk = await yessenovSigningKey(header.kid, input.fetcher ?? fetch);
  const validSignature = verify(
    "RSA-SHA256",
    Buffer.from(`${encodedHeader}.${encodedClaims}`),
    createPublicKey({ key: jwk, format: "jwk" }),
    Buffer.from(encodedSignature, "base64url"),
  );
  if (!validSignature) throw new Error("Invalid Yessenov ID token signature");

  const now = input.now ?? Math.floor(Date.now() / 1000);
  const audience = Array.isArray(claims.aud)
    ? claims.aud.filter((value): value is string => typeof value === "string")
    : typeof claims.aud === "string"
      ? [claims.aud]
      : [];
  const subject = typeof claims.sub === "string" ? claims.sub.trim() : "";
  const email = typeof claims.email === "string"
    ? claims.email.trim().toLowerCase()
    : "";
  if (
    claims.iss !== YESSENOV_ISSUER ||
    !audience.includes(input.clientId) ||
    (audience.length > 1 && claims.azp !== input.clientId) ||
    !subject ||
    subject.length > 255 ||
    claims.nonce !== input.nonce ||
    typeof claims.exp !== "number" ||
    claims.exp <= now - CLOCK_SKEW_SECONDS ||
    typeof claims.iat !== "number" ||
    claims.iat > now + CLOCK_SKEW_SECONDS ||
    claims.email_verified !== true ||
    claims.is_personnel !== true ||
    !email.endsWith("@yu.edu.kz") ||
    email.length > 254
  ) {
    throw new Error("Invalid Yessenov ID token claims");
  }
  const name = identityName(claims);
  if (name.length < 2 || name.length > 120) {
    throw new Error("Invalid Yessenov ID profile");
  }
  const iin = typeof claims.iin === "string" && /^[0-9]{12}$/.test(claims.iin)
    ? claims.iin
    : null;
  return { subject, email, name, iin };
}

async function yessenovSigningKey(kid: string, fetcher: typeof fetch) {
  const now = Date.now();
  if (!cachedJwks || cachedJwks.expiresAt <= now) {
    cachedJwks = await fetchYessenovSigningKeys(fetcher, now);
  }
  let key = findSigningKey(cachedJwks.keys, kid);
  if (!key) {
    cachedJwks = await fetchYessenovSigningKeys(fetcher, now);
    key = findSigningKey(cachedJwks.keys, kid);
  }
  if (!key) throw new Error("Yessenov signing key was not found");
  return key;
}

function findSigningKey(keys: CryptoJsonWebKey[], kid: string) {
  return keys.find(
    (candidate) =>
      candidate.kid === kid &&
      candidate.kty === "RSA" &&
      (!candidate.use || candidate.use === "sig") &&
      (!candidate.alg || candidate.alg === "RS256"),
  );
}

async function fetchYessenovSigningKeys(fetcher: typeof fetch, now: number) {
  const response = await fetcher(YESSENOV_JWKS_ENDPOINT, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await response.json().catch(() => null)) as JwkSet | null;
  if (!response.ok || !Array.isArray(body?.keys)) {
    throw new Error("Yessenov signing keys are unavailable");
  }
  return {
    keys: body.keys,
    expiresAt: now + cacheLifetimeMs(response.headers.get("cache-control")),
  };
}

function identityName(claims: IdTokenClaims): string {
  const explicit = typeof claims.name === "string"
    ? claims.name.trim().replace(/\s+/gu, " ")
    : "";
  if (explicit) return explicit;
  return [claims.family_name, claims.given_name, claims.middle_name]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/gu, " ");
}

function cacheLifetimeMs(cacheControl: string | null) {
  const seconds = Number(cacheControl?.match(/(?:^|,)\s*max-age=(\d+)/i)?.[1]);
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(seconds, 24 * 60 * 60) * 1000
    : 60 * 60 * 1000;
}

function decodeJson<T>(value: string): T {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
  } catch {
    throw new Error("Invalid Yessenov ID token");
  }
}

export function resetYessenovSigningKeysForTests() {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Yessenov signing keys can only be reset in tests");
  }
  cachedJwks = undefined;
}

import "server-only";

import {
  createHash,
  createPublicKey,
  randomBytes,
  verify,
} from "node:crypto";
import type { JsonWebKey as CryptoJsonWebKey } from "node:crypto";
import { isSafeReturnPath } from "@/lib/security/authorization";
import {
  createSignedServerValue,
  verifySignedServerValue,
} from "@/lib/security/session";

const GOOGLE_AUTHORIZATION_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_ENDPOINT = "https://www.googleapis.com/oauth2/v3/certs";
const REQUIRED_GOOGLE_WORKSPACE_DOMAIN = "yu.edu.kz";
const GOOGLE_ISSUERS = new Set([
  "https://accounts.google.com",
  "accounts.google.com",
]);
const OAUTH_TRANSACTION_TTL_SECONDS = 10 * 60;
const CLOCK_SKEW_SECONDS = 60;

export const GOOGLE_SSO_TRANSACTION_COOKIE =
  "yu_inventory_google_transaction";
export const GOOGLE_SSO_COOKIE_PATH = "/api/auth/google";
export const GOOGLE_SSO_TRANSACTION_TTL_SECONDS =
  OAUTH_TRANSACTION_TTL_SECONDS;

export interface GoogleSsoConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  hostedDomain: string;
}

export interface GoogleAuthorizationRequest {
  url: URL;
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string | null;
}

export interface GoogleSsoTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string | null;
  expiresAt: number;
}

export interface GoogleIdentity {
  subject: string;
  email: string;
  name: string | null;
  hostedDomain: string;
}

interface GoogleIdTokenHeader {
  alg?: unknown;
  kid?: unknown;
}

interface GoogleIdTokenClaims {
  iss?: unknown;
  aud?: unknown;
  azp?: unknown;
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  hd?: unknown;
  nonce?: unknown;
  iat?: unknown;
  exp?: unknown;
}

interface GoogleJwkSet {
  keys?: CryptoJsonWebKey[];
}

let cachedJwks:
  | {
      keys: CryptoJsonWebKey[];
      expiresAt: number;
    }
  | undefined;

export function googleSsoConfig(
  environment: NodeJS.ProcessEnv = process.env,
): GoogleSsoConfig | null {
  const clientId = environment.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = environment.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = environment.GOOGLE_REDIRECT_URI?.trim();
  const hostedDomain = (
    environment.GOOGLE_WORKSPACE_DOMAIN?.trim() ||
    REQUIRED_GOOGLE_WORKSPACE_DOMAIN
  ).toLowerCase();

  if (!clientId || !clientSecret || !redirectUri) return null;
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
    callback.pathname !== "/api/auth/google/callback" ||
    hostedDomain !== REQUIRED_GOOGLE_WORKSPACE_DOMAIN
  ) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    redirectUri: callback.toString(),
    hostedDomain,
  };
}

export function isGoogleSsoConfigured(
  environment: NodeJS.ProcessEnv = process.env,
) {
  return googleSsoConfig(environment) !== null;
}

export function createGoogleAuthorizationRequest(
  config: GoogleSsoConfig,
  returnTo?: string | null,
): GoogleAuthorizationRequest {
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  const safeReturnTo = isSafeReturnPath(returnTo) ? returnTo! : null;
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    hd: config.hostedDomain,
    prompt: "select_account",
  }).toString();

  return { url, state, nonce, codeVerifier, returnTo: safeReturnTo };
}

export function createGoogleSsoTransactionToken(
  request: GoogleAuthorizationRequest,
  now = Math.floor(Date.now() / 1000),
) {
  const transaction: GoogleSsoTransaction = {
    state: request.state,
    nonce: request.nonce,
    codeVerifier: request.codeVerifier,
    returnTo: request.returnTo,
    expiresAt: now + OAUTH_TRANSACTION_TTL_SECONDS,
  };
  return createSignedServerValue(
    "google-sso-transaction",
    JSON.stringify(transaction),
  );
}

export function verifyGoogleSsoTransactionToken(
  token: string,
  now = Math.floor(Date.now() / 1000),
): GoogleSsoTransaction | null {
  const value = verifySignedServerValue("google-sso-transaction", token);
  if (!value) return null;
  try {
    const transaction = JSON.parse(value) as Partial<GoogleSsoTransaction>;
    if (
      typeof transaction.state !== "string" ||
      transaction.state.length < 32 ||
      transaction.state.length > 256 ||
      typeof transaction.nonce !== "string" ||
      transaction.nonce.length < 32 ||
      transaction.nonce.length > 256 ||
      typeof transaction.codeVerifier !== "string" ||
      transaction.codeVerifier.length < 43 ||
      transaction.codeVerifier.length > 128 ||
      (transaction.returnTo !== null &&
        !isSafeReturnPath(transaction.returnTo)) ||
      typeof transaction.expiresAt !== "number" ||
      transaction.expiresAt <= now
    ) {
      return null;
    }
    return transaction as GoogleSsoTransaction;
  } catch {
    return null;
  }
}

export async function exchangeGoogleAuthorizationCode(
  config: GoogleSsoConfig,
  code: string,
  codeVerifier: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const response = await fetcher(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      code_verifier: codeVerifier,
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
    throw new Error("Google token exchange failed");
  }
  return body.id_token;
}

export async function verifyGoogleIdToken(
  idToken: string,
  input: {
    clientId: string;
    hostedDomain: string;
    nonce: string;
    now?: number;
    fetcher?: typeof fetch;
  },
): Promise<GoogleIdentity> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Invalid Google ID token");
  const [encodedHeader, encodedClaims, encodedSignature] = parts;
  if (!encodedHeader || !encodedClaims || !encodedSignature) {
    throw new Error("Invalid Google ID token");
  }

  const header = decodeJson<GoogleIdTokenHeader>(encodedHeader);
  const claims = decodeJson<GoogleIdTokenClaims>(encodedClaims);
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new Error("Unsupported Google ID token");
  }

  const jwk = await googleSigningKey(header.kid, input.fetcher ?? fetch);
  const validSignature = verify(
    "RSA-SHA256",
    Buffer.from(`${encodedHeader}.${encodedClaims}`),
    createPublicKey({ key: jwk, format: "jwk" }),
    Buffer.from(encodedSignature, "base64url"),
  );
  if (!validSignature) throw new Error("Invalid Google ID token signature");

  const now = input.now ?? Math.floor(Date.now() / 1000);
  const audience = Array.isArray(claims.aud)
    ? claims.aud
    : typeof claims.aud === "string"
      ? [claims.aud]
      : [];
  if (
    typeof claims.iss !== "string" ||
    !GOOGLE_ISSUERS.has(claims.iss) ||
    audience.length !== 1 ||
    audience[0] !== input.clientId ||
    (claims.azp !== undefined && claims.azp !== input.clientId) ||
    typeof claims.sub !== "string" ||
    !claims.sub ||
    typeof claims.exp !== "number" ||
    claims.exp <= now - CLOCK_SKEW_SECONDS ||
    typeof claims.iat !== "number" ||
    claims.iat > now + CLOCK_SKEW_SECONDS ||
    claims.nonce !== input.nonce ||
    claims.email_verified !== true ||
    typeof claims.email !== "string" ||
    typeof claims.hd !== "string"
  ) {
    throw new Error("Invalid Google ID token claims");
  }

  const hostedDomain = input.hostedDomain.toLowerCase();
  const email = claims.email.trim().toLowerCase();
  if (
    claims.hd.toLowerCase() !== hostedDomain ||
    !email.endsWith(`@${hostedDomain}`) ||
    email.length > 254
  ) {
    throw new Error("Google Workspace domain is not allowed");
  }

  return {
    subject: claims.sub,
    email,
    name: typeof claims.name === "string" ? claims.name.trim() || null : null,
    hostedDomain,
  };
}

async function googleSigningKey(kid: string, fetcher: typeof fetch) {
  const now = Date.now();
  if (!cachedJwks || cachedJwks.expiresAt <= now) {
    cachedJwks = await fetchGoogleSigningKeys(fetcher, now);
  }

  let key = findGoogleSigningKey(cachedJwks.keys, kid);
  if (!key) {
    cachedJwks = await fetchGoogleSigningKeys(fetcher, now);
    key = findGoogleSigningKey(cachedJwks.keys, kid);
  }
  if (!key) throw new Error("Google signing key was not found");
  return key;
}

function findGoogleSigningKey(
  keys: CryptoJsonWebKey[],
  kid: string,
) {
  return keys.find(
    (candidate) =>
      candidate.kid === kid &&
      candidate.kty === "RSA" &&
      (!candidate.use || candidate.use === "sig") &&
      (!candidate.alg || candidate.alg === "RS256"),
  );
}

async function fetchGoogleSigningKeys(fetcher: typeof fetch, now: number) {
  const response = await fetcher(GOOGLE_JWKS_ENDPOINT, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await response.json().catch(() => null)) as GoogleJwkSet | null;
  if (!response.ok || !Array.isArray(body?.keys)) {
    throw new Error("Google signing keys are unavailable");
  }
  return {
    keys: body.keys,
    expiresAt: now + cacheLifetimeMs(response.headers.get("cache-control")),
  };
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
    throw new Error("Invalid Google ID token");
  }
}

export function resetGoogleSigningKeysForTests() {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Google signing keys can only be reset in tests");
  }
  cachedJwks = undefined;
}

import "server-only";

import {
  createHash,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  getClientIp,
  InMemoryRateLimiter,
  consumeDurableRateLimit,
  type RateLimitResult,
} from "./rate-limiter";
import { normalizeEmail } from "./login-protection";
import { createServerValueDigest } from "./session";
import { getDatabasePool } from "@/lib/db/client";

const RESET_CODE_TTL_MS = 15 * 60_000;
const RESET_CODE_ATTEMPTS = 5;

interface ResetCodeRecord {
  codeHash: string;
  expiresAt: number;
  attempts: number;
  generation: number;
}

interface ResetCodeState {
  nextGeneration: number;
  pending: Map<string, ResetCodeRecord>;
  delivered?: ResetCodeRecord;
}

type PasswordResetGlobal = typeof globalThis & {
  __yuInventoryPasswordResetCodes?: Map<string, ResetCodeState>;
};

const requestByIp = new InMemoryRateLimiter({
  namespace: "password-reset-request-by-ip-v1",
  limit: 10,
  windowMs: 60 * 60_000,
});

const requestByEmail = new InMemoryRateLimiter({
  namespace: "password-reset-request-by-email-v1",
  limit: 3,
  windowMs: 60 * 60_000,
});

const confirmationByIp = new InMemoryRateLimiter({
  namespace: "password-reset-confirm-by-ip-v1",
  limit: 30,
  windowMs: 15 * 60_000,
});

function records() {
  const shared = globalThis as PasswordResetGlobal;
  shared.__yuInventoryPasswordResetCodes ??= new Map();
  return shared.__yuInventoryPasswordResetCodes;
}

function stateFor(key: string) {
  const existing = records().get(key);
  if (existing) return existing;
  const state: ResetCodeState = {
    nextGeneration: 1,
    pending: new Map(),
  };
  records().set(key, state);
  return state;
}

function removeEmptyState(key: string, state: ResetCodeState) {
  if (!state.delivered && state.pending.size === 0) records().delete(key);
}

function emailKey(email: string) {
  return createHash("sha256").update(normalizeEmail(email)).digest("hex");
}

function hashCode(email: string, code: string) {
  return createHash("sha256")
    .update(`${normalizeEmail(email)}:${code}`)
    .digest("hex");
}

export function createPasswordResetUrl(publicOrigin: string, email: string) {
  let origin: URL;
  try {
    origin = new URL(publicOrigin);
  } catch {
    throw new Error("invalid_password_reset_public_origin");
  }
  const localDevelopmentOrigin =
    origin.protocol === "http:" &&
    (origin.hostname === "localhost" ||
      origin.hostname === "127.0.0.1" ||
      origin.hostname === "[::1]");
  if (
    (origin.protocol !== "https:" && !localDevelopmentOrigin) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error("invalid_password_reset_public_origin");
  }

  const resetUrl = new URL("/reset-password", origin.origin);
  resetUrl.searchParams.set("email", normalizeEmail(email));
  return resetUrl.toString();
}

export function consumePasswordResetRequestLimits(
  request: Request,
  email: string,
): RateLimitResult | Promise<RateLimitResult> {
  if (process.env.NODE_ENV !== "test") {
    return consumeDurablePasswordResetRequestLimits(request, email);
  }
  const ipResult = requestByIp.consume(getClientIp(request));
  if (!ipResult.allowed) return ipResult;
  return requestByEmail.consume(emailKey(email));
}

export function consumePasswordResetConfirmationLimit(request: Request) {
  if (process.env.NODE_ENV !== "test") {
    return consumeDurableRateLimit({
      namespace: "password-reset-confirm-ip-v2",
      key: getClientIp(request),
      limit: 30,
      windowMs: 15 * 60_000,
    });
  }
  return confirmationByIp.consume(getClientIp(request));
}

async function consumeDurablePasswordResetRequestLimits(
  request: Request,
  email: string,
) {
  const ipResult = await consumeDurableRateLimit({
    namespace: "password-reset-request-ip-v2",
    key: getClientIp(request),
    limit: 10,
    windowMs: 60 * 60_000,
  });
  if (!ipResult.allowed) return ipResult;
  return consumeDurableRateLimit({
    namespace: "password-reset-request-email-v2",
    key: emailKey(email),
    limit: 3,
    windowMs: 60 * 60_000,
  });
}

export async function createPasswordResetCode(email: string) {
  const code = randomInt(100_000, 1_000_000).toString();
  if (process.env.NODE_ENV !== "test") {
    await getDatabasePool().query(
      `insert into "yu_inventory"."password_reset_challenges"
         (id, email_key, code_digest, status, expires_at)
       values ($1, $2, $3, 'pending', now() + interval '15 minutes')`,
      [randomUUID(), emailKey(email), durableCodeDigest(email, code)],
    );
    return code;
  }
  const key = emailKey(email);
  const state = stateFor(key);
  const codeHash = hashCode(email, code);
  state.pending.set(codeHash, {
    codeHash,
    expiresAt: Date.now() + RESET_CODE_TTL_MS,
    attempts: 0,
    generation: state.nextGeneration,
  });
  state.nextGeneration += 1;
  return code;
}

export async function commitPasswordResetCode(email: string, code: string) {
  if (process.env.NODE_ENV !== "test") {
    const pool = getDatabasePool();
    const client = await pool.connect();
    try {
      await client.query("begin");
      const key = emailKey(email);
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 731003))", [key]);
      const pending = await client.query<{ id: string; generation: string }>(
        `select id, generation from "yu_inventory"."password_reset_challenges"
          where email_key = $1 and code_digest = $2 and status = 'pending'
          for update`,
        [key, durableCodeDigest(email, code)],
      );
      const record = pending.rows[0];
      if (record) {
        await client.query(
          `delete from "yu_inventory"."password_reset_challenges"
            where email_key = $1 and status = 'delivered' and generation < $2`,
          [key, record.generation],
        );
        const newer = await client.query(
          `select 1 from "yu_inventory"."password_reset_challenges"
            where email_key = $1 and status = 'delivered' and generation > $2`,
          [key, record.generation],
        );
        if ((newer.rowCount ?? 0) > 0) {
          await client.query(
            `delete from "yu_inventory"."password_reset_challenges" where id = $1`,
            [record.id],
          );
        } else {
          await client.query(
            `update "yu_inventory"."password_reset_challenges"
                set status = 'delivered'
              where id = $1`,
            [record.id],
          );
        }
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    return;
  }
  const key = emailKey(email);
  const state = records().get(key);
  if (!state) return;
  const codeHash = hashCode(email, code);
  const record = state.pending.get(codeHash);
  if (!record) return;
  state.pending.delete(codeHash);
  if (!state.delivered || record.generation >= state.delivered.generation) {
    state.delivered = record;
  }
  removeEmptyState(key, state);
}

export async function revokePasswordResetCode(email: string, code?: string) {
  if (process.env.NODE_ENV !== "test") {
    const key = emailKey(email);
    if (code === undefined) {
      await getDatabasePool().query(
        `delete from "yu_inventory"."password_reset_challenges" where email_key = $1`,
        [key],
      );
    } else {
      await getDatabasePool().query(
        `delete from "yu_inventory"."password_reset_challenges"
          where email_key = $1 and code_digest = $2 and status = 'pending'`,
        [key, durableCodeDigest(email, code)],
      );
    }
    return;
  }
  const key = emailKey(email);
  if (code === undefined) {
    records().delete(key);
    return;
  }

  const state = records().get(key);
  if (!state) return;
  state.pending.delete(hashCode(email, code));
  removeEmptyState(key, state);
}

export async function verifyAndConsumePasswordResetCode(email: string, code: string) {
  if (process.env.NODE_ENV !== "test") {
    const pool = getDatabasePool();
    const client = await pool.connect();
    try {
      await client.query("begin");
      const key = emailKey(email);
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 731003))", [key]);
      const result = await client.query<{
        id: string;
        code_digest: string;
        attempts: number;
        expired: boolean;
      }>(
        `select id, code_digest, attempts, expires_at <= now() as expired
           from "yu_inventory"."password_reset_challenges"
          where email_key = $1 and status = 'delivered'
          order by generation desc limit 1
          for update`,
        [key],
      );
      const record = result.rows[0];
      if (!record || record.expired) {
        if (record) {
          await client.query(
            `delete from "yu_inventory"."password_reset_challenges" where id = $1`,
            [record.id],
          );
        }
        await client.query("commit");
        return false;
      }
      const expected = Buffer.from(record.code_digest);
      const received = Buffer.from(durableCodeDigest(email, code));
      const matches =
        expected.length === received.length && timingSafeEqual(expected, received);
      if (matches || record.attempts + 1 >= RESET_CODE_ATTEMPTS) {
        await client.query(
          `delete from "yu_inventory"."password_reset_challenges" where id = $1`,
          [record.id],
        );
      } else {
        await client.query(
          `update "yu_inventory"."password_reset_challenges"
              set attempts = attempts + 1 where id = $1`,
          [record.id],
        );
      }
      await client.query("commit");
      return matches;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
  const key = emailKey(email);
  const state = records().get(key);
  const record = state?.delivered;
  if (!record || record.expiresAt <= Date.now()) {
    if (state) {
      delete state.delivered;
      removeEmptyState(key, state);
    }
    return false;
  }

  record.attempts += 1;
  if (record.attempts > RESET_CODE_ATTEMPTS) {
    delete state!.delivered;
    removeEmptyState(key, state!);
    return false;
  }

  const expected = Buffer.from(record.codeHash);
  const received = Buffer.from(hashCode(email, code));
  const matches =
    expected.length === received.length && timingSafeEqual(expected, received);

  if (matches) {
    records().delete(key);
  }
  return matches;
}

/**
 * Restores a correctly verified challenge only when the credential write failed.
 * This avoids locking a user out because of a transient database failure while
 * keeping the restored challenge short-lived and single-use.
 */
export async function restoreConsumedPasswordResetCode(email: string, code: string) {
  if (process.env.NODE_ENV !== "test") {
    const key = emailKey(email);
    await getDatabasePool().query(
      `insert into "yu_inventory"."password_reset_challenges"
         (id, email_key, code_digest, status, expires_at)
       values ($1, $2, $3, 'delivered', now() + interval '5 minutes')
       on conflict (email_key) where status = 'delivered' do nothing`,
      [randomUUID(), key, durableCodeDigest(email, code)],
    );
    return;
  }

  const key = emailKey(email);
  const state = stateFor(key);
  const codeHash = hashCode(email, code);
  state.delivered = {
    codeHash,
    expiresAt: Date.now() + 5 * 60_000,
    attempts: 0,
    generation: state.nextGeneration,
  };
  state.nextGeneration += 1;
}

function durableCodeDigest(email: string, code: string) {
  return createServerValueDigest(
    "password-reset-v1",
    `${normalizeEmail(email)}:${code}`,
  );
}

export function resetPasswordResetStateForTests() {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Password-reset state can only be reset in tests");
  }
  records().clear();
}

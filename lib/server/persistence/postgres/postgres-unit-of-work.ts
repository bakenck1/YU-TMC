import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import type {
  TransactionIsolation,
  TransactionOptions,
  UnitOfWork,
} from "@/lib/application/ports/unit-of-work";
import { getDatabasePool } from "@/lib/db/client";
import type { Pool, PoolClient } from "pg";

export type PostgresRepositorySource = Pool | PoolClient;
export type PostgresRepositoryFactory<Repositories> = (
  source: PostgresRepositorySource,
) => Repositories;

interface ActiveTransaction<Repositories> {
  readonly client: PoolClient;
  readonly lifecycle: TransactionLifecycle;
  readonly options: NormalizedTransactionOptions;
  readonly repositories: Repositories;
  rootSavepointInUse: boolean;
  savepointCounter: number;
}

interface NestedTransactionContext {
  readonly transaction: object;
  childInUse: boolean;
}

interface TransactionLifecycle {
  closed: boolean;
}

interface NormalizedTransactionOptions {
  readonly isolation: TransactionIsolation;
  readonly maxAttempts: 1 | 2 | 3;
  readonly readOnly: boolean;
}

export interface PostgresUnitOfWorkDependencies {
  random?: () => number;
  retryBaseDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export class NestedTransactionOptionsError extends Error {
  constructor() {
    super("A nested transaction cannot change isolation or read-only mode.");
    this.name = "NestedTransactionOptionsError";
  }
}

export class ClosedTransactionScopeError extends Error {
  constructor() {
    super(
      "Transaction-bound repositories cannot be used after their callback has finished.",
    );
    this.name = "ClosedTransactionScopeError";
  }
}

export class ConcurrentNestedTransactionError extends Error {
  constructor() {
    super("Concurrent nested transactions on one PostgreSQL client are not supported.");
    this.name = "ConcurrentNestedTransactionError";
  }
}

export class PostgresUnitOfWork<Repositories>
  implements UnitOfWork<Repositories>
{
  private readonly transactionStorage =
    new AsyncLocalStorage<ActiveTransaction<Repositories>>();
  private readonly nestedTransactionStorage =
    new AsyncLocalStorage<NestedTransactionContext>();
  private readonly random: () => number;
  private readonly retryBaseDelayMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(
    private readonly pool: () => Pool,
    private readonly createRepositories: PostgresRepositoryFactory<Repositories>,
    dependencies: PostgresUnitOfWorkDependencies = {},
  ) {
    this.random = dependencies.random ?? Math.random;
    this.retryBaseDelayMs = dependencies.retryBaseDelayMs ?? 10;
    this.sleep =
      dependencies.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  read<Result>(
    work: (repositories: Repositories) => Promise<Result>,
  ): Promise<Result> {
    const active = this.transactionStorage.getStore();
    if (active) {
      assertTransactionScopeOpen(active);
      return work(active.repositories);
    }
    return work(this.createRepositories(this.pool()));
  }

  async transaction<Result>(
    work: (repositories: Repositories) => Promise<Result>,
    options: TransactionOptions = {},
  ): Promise<Result> {
    const active = this.transactionStorage.getStore();
    if (active) {
      assertTransactionScopeOpen(active);
      assertCompatibleNestedOptions(active.options, options);
      return this.runNestedTransaction(active, work);
    }

    const normalized = normalizeOptions(options);
    for (let attempt = 1; attempt <= normalized.maxAttempts; attempt += 1) {
      try {
        return await this.runTransactionAttempt(work, normalized);
      } catch (error) {
        if (!isRetryableTransactionError(error) || attempt === normalized.maxAttempts) {
          throw error;
        }
        await this.sleep(this.retryDelay(attempt));
      }
    }

    throw new Error("Transaction retry loop ended unexpectedly.");
  }

  private async runTransactionAttempt<Result>(
    work: (repositories: Repositories) => Promise<Result>,
    options: NormalizedTransactionOptions,
  ): Promise<Result> {
    const client = await this.pool().connect();
    let began = false;
    let destroyClient = false;
    let lifecycle: TransactionLifecycle | undefined;

    try {
      await client.query(beginStatement(options));
      began = true;
      const transactionLifecycle: TransactionLifecycle = { closed: false };
      lifecycle = transactionLifecycle;
      const transactionSource = guardTransactionSource(
        client,
        transactionLifecycle,
      );
      const repositories = this.createRepositories(transactionSource);
      const scope: ActiveTransaction<Repositories> = {
        client: transactionSource,
        lifecycle,
        options,
        repositories,
        rootSavepointInUse: false,
        savepointCounter: 0,
      };

      return await this.transactionStorage.run(
        scope,
        async () => {
          try {
            const result = await work(repositories);
            transactionLifecycle.closed = true;
            await client.query("COMMIT");
            began = false;
            return result;
          } finally {
            transactionLifecycle.closed = true;
          }
        },
      );
    } catch (error) {
      if (lifecycle) lifecycle.closed = true;
      destroyClient = isFatalConnectionError(error);
      if (began) {
        try {
          await client.query("ROLLBACK");
        } catch {
          destroyClient = true;
        }
      }
      throw error;
    } finally {
      if (lifecycle) lifecycle.closed = true;
      client.release(destroyClient);
    }
  }

  private retryDelay(failedAttempt: number) {
    const boundedRandom = Math.min(1, Math.max(0, this.random()));
    const exponentialDelay =
      this.retryBaseDelayMs * 2 ** Math.max(0, failedAttempt - 1);
    return Math.round(exponentialDelay * (0.5 + boundedRandom * 0.5));
  }

  private async runNestedTransaction<Result>(
    active: ActiveTransaction<Repositories>,
    work: (repositories: Repositories) => Promise<Result>,
  ): Promise<Result> {
    const parent = this.nestedTransactionStorage.getStore();
    const isNestedChild = parent?.transaction === active;
    if (isNestedChild) {
      if (parent.childInUse) throw new ConcurrentNestedTransactionError();
      parent.childInUse = true;
    } else {
      if (active.rootSavepointInUse) {
        throw new ConcurrentNestedTransactionError();
      }
      active.rootSavepointInUse = true;
    }
    const savepoint = `yu_nested_${++active.savepointCounter}`;
    try {
      await active.client.query(`SAVEPOINT ${savepoint}`);
      try {
        const result = await this.nestedTransactionStorage.run(
          { transaction: active, childInUse: false },
          () => work(active.repositories),
        );
        await active.client.query(`RELEASE SAVEPOINT ${savepoint}`);
        return result;
      } catch (error) {
        try {
          await active.client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          await active.client.query(`RELEASE SAVEPOINT ${savepoint}`);
        } catch (recoveryError) {
          throw new SavepointRecoveryError(recoveryError);
        }
        throw error;
      }
    } finally {
      if (isNestedChild && parent) parent.childInUse = false;
      else active.rootSavepointInUse = false;
    }
  }
}

class SavepointRecoveryError extends Error {
  readonly fatal = true;

  constructor(cause: unknown) {
    super("Failed to recover a nested PostgreSQL transaction.", { cause });
    this.name = "SavepointRecoveryError";
  }
}

export function createPostgresUnitOfWork<Repositories>(
  createRepositories: PostgresRepositoryFactory<Repositories>,
  dependencies?: PostgresUnitOfWorkDependencies,
) {
  return new PostgresUnitOfWork(
    getDatabasePool,
    createRepositories,
    dependencies,
  );
}

function normalizeOptions(
  options: TransactionOptions,
): NormalizedTransactionOptions {
  return {
    isolation: options.isolation ?? "read-committed",
    maxAttempts: options.maxAttempts ?? 3,
    readOnly: options.readOnly ?? false,
  };
}

function assertCompatibleNestedOptions(
  active: NormalizedTransactionOptions,
  requested: TransactionOptions,
) {
  if (
    (requested.isolation !== undefined &&
      requested.isolation !== active.isolation) ||
    (requested.readOnly !== undefined &&
      requested.readOnly !== active.readOnly)
  ) {
    throw new NestedTransactionOptionsError();
  }
}

function assertTransactionScopeOpen(
  transaction: ActiveTransaction<unknown>,
) {
  assertTransactionLifecycleOpen(transaction.lifecycle);
}

function assertTransactionLifecycleOpen(lifecycle: TransactionLifecycle) {
  if (lifecycle.closed) throw new ClosedTransactionScopeError();
}

function guardTransactionSource(
  client: PoolClient,
  lifecycle: TransactionLifecycle,
): PoolClient {
  const guardedMethods = new Map<PropertyKey, unknown>();

  return new Proxy(client, {
    get(target, property) {
      assertTransactionLifecycleOpen(lifecycle);
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;

      if (!guardedMethods.has(property)) {
        guardedMethods.set(property, (...args: unknown[]) => {
          assertTransactionLifecycleOpen(lifecycle);
          return Reflect.apply(value, target, args);
        });
      }
      return guardedMethods.get(property);
    },
    set(target, property, value) {
      assertTransactionLifecycleOpen(lifecycle);
      return Reflect.set(target, property, value, target);
    },
  });
}

function beginStatement(options: NormalizedTransactionOptions) {
  const isolation = {
    "read-committed": "READ COMMITTED",
    "repeatable-read": "REPEATABLE READ",
    serializable: "SERIALIZABLE",
  }[options.isolation];
  return `BEGIN ISOLATION LEVEL ${isolation}, ${
    options.readOnly ? "READ ONLY" : "READ WRITE"
  }`;
}

function isRetryableTransactionError(error: unknown) {
  const code = errorCode(error);
  return code === "40001" || code === "40P01";
}

function isFatalConnectionError(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "fatal" in error &&
    (error as { fatal?: unknown }).fatal === true
  ) {
    return true;
  }

  const code = errorCode(error);
  return (
    code?.startsWith("08") === true ||
    code === "57P01" ||
    code === "57P02" ||
    code === "57P03" ||
    code === "ECONNRESET" ||
    code === "EPIPE" ||
    code === "PROTOCOL_CONNECTION_LOST"
  );
}

function errorCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

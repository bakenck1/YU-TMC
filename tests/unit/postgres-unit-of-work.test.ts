import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";

import {
  ClosedTransactionScopeError,
  NestedTransactionOptionsError,
  PostgresUnitOfWork,
  type PostgresRepositorySource,
} from "@/lib/server/persistence/postgres/postgres-unit-of-work";

interface FakeClient {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
}

interface TestRepositories {
  readonly source: PostgresRepositorySource;
}

function createClient(
  queryImplementation: (sql: string) => Promise<unknown> = async () => ({
    rows: [],
  }),
): FakeClient {
  return {
    query: vi.fn(queryImplementation),
    release: vi.fn(),
  };
}

function createPool(clients: FakeClient[]) {
  const connect = vi.fn();
  for (const client of clients) {
    connect.mockResolvedValueOnce(client as unknown as PoolClient);
  }
  return {
    connect,
    pool: { connect } as unknown as Pool,
  };
}

function createUnitOfWork(
  pool: Pool,
  dependencies: ConstructorParameters<
    typeof PostgresUnitOfWork<TestRepositories>
  >[2] = {},
) {
  return new PostgresUnitOfWork<TestRepositories>(
    () => pool,
    (source) => ({ source }),
    dependencies,
  );
}

function sqlState(code: string) {
  return Object.assign(new Error(`PostgreSQL ${code}`), { code });
}

describe("PostgresUnitOfWork", () => {
  it("commits successful work on one checked-out client", async () => {
    const client = createClient();
    const { connect, pool } = createPool([client]);
    const unitOfWork = createUnitOfWork(pool);

    await expect(
      unitOfWork.transaction(async ({ source }) => {
        await source.query("SELECT 'inside transaction'");
        return "done";
      }),
    ).resolves.toBe("done");

    expect(connect).toHaveBeenCalledOnce();
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN ISOLATION LEVEL READ COMMITTED, READ WRITE",
      "SELECT 'inside transaction'",
      "COMMIT",
    ]);
    expect(client.release).toHaveBeenCalledWith(false);
  });

  it("rolls back callback failures and preserves the original error", async () => {
    const failure = new Error("domain failure");
    const client = createClient();
    const { pool } = createPool([client]);
    const unitOfWork = createUnitOfWork(pool);

    await expect(
      unitOfWork.transaction(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN ISOLATION LEVEL READ COMMITTED, READ WRITE",
      "ROLLBACK",
    ]);
    expect(client.release).toHaveBeenCalledWith(false);
  });

  it("does not mask the original error when rollback fails", async () => {
    const failure = new Error("primary failure");
    const client = createClient(async (sql) => {
      if (sql === "ROLLBACK") throw new Error("rollback failed");
      return { rows: [] };
    });
    const { pool } = createPool([client]);
    const unitOfWork = createUnitOfWork(pool);

    await expect(
      unitOfWork.transaction(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it("rolls back when commit fails", async () => {
    const commitFailure = new Error("commit failed");
    const client = createClient(async (sql) => {
      if (sql === "COMMIT") throw commitFailure;
      return { rows: [] };
    });
    const { pool } = createPool([client]);
    const unitOfWork = createUnitOfWork(pool);

    await expect(
      unitOfWork.transaction(async () => "result"),
    ).rejects.toBe(commitFailure);
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN ISOLATION LEVEL READ COMMITTED, READ WRITE",
      "COMMIT",
      "ROLLBACK",
    ]);
    expect(client.release).toHaveBeenCalledWith(false);
  });

  it.each(["40001", "40P01"])(
    "retries SQLSTATE %s on a fresh client",
    async (code) => {
      const first = createClient();
      const second = createClient();
      const { connect, pool } = createPool([first, second]);
      const sleep = vi.fn(async () => undefined);
      const unitOfWork = createUnitOfWork(pool, {
        random: () => 0,
        retryBaseDelayMs: 10,
        sleep,
      });
      let attempts = 0;

      await expect(
        unitOfWork.transaction(async ({ source }) => {
          attempts += 1;
          if (attempts === 1) throw sqlState(code);
          await source.query("SELECT 'retried transaction'");
          return "retried";
        }),
      ).resolves.toBe("retried");

      expect(connect).toHaveBeenCalledTimes(2);
      expect(first.query.mock.calls.map(([sql]) => sql)).toContain("ROLLBACK");
      expect(second.query.mock.calls.map(([sql]) => sql)).toContain(
        "SELECT 'retried transaction'",
      );
      expect(first.release).toHaveBeenCalledBefore(second.query);
      expect(sleep).toHaveBeenCalledWith(5);
    },
  );

  it("stops at the configured retry limit", async () => {
    const clients = [createClient(), createClient(), createClient()];
    const { connect, pool } = createPool(clients);
    const sleep = vi.fn(async () => undefined);
    const unitOfWork = createUnitOfWork(pool, { sleep });

    await expect(
      unitOfWork.transaction(
        async () => {
          throw sqlState("40001");
        },
        { maxAttempts: 3 },
      ),
    ).rejects.toMatchObject({ code: "40001" });
    expect(connect).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("does not retry integrity or arbitrary failures", async () => {
    for (const failure of [sqlState("23505"), new Error("domain")]) {
      const client = createClient();
      const { connect, pool } = createPool([client]);
      const sleep = vi.fn(async () => undefined);
      const unitOfWork = createUnitOfWork(pool, { sleep });

      await expect(
        unitOfWork.transaction(async () => {
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(connect).toHaveBeenCalledOnce();
      expect(sleep).not.toHaveBeenCalled();
    }
  });

  it("joins nested transactions and transaction-bound reads", async () => {
    const client = createClient();
    const { connect, pool } = createPool([client]);
    const unitOfWork = createUnitOfWork(pool);

    await unitOfWork.transaction(async (outerRepositories) => {
      await unitOfWork.transaction(async (innerRepositories) => {
        expect(innerRepositories).toBe(outerRepositories);
      });
      await unitOfWork.read(async (readRepositories) => {
        expect(readRepositories).toBe(outerRepositories);
      });
    });

    expect(connect).toHaveBeenCalledOnce();
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN ISOLATION LEVEL READ COMMITTED, READ WRITE",
      "COMMIT",
    ]);
  });

  it("rejects incompatible nested transaction modes", async () => {
    const client = createClient();
    const { pool } = createPool([client]);
    const unitOfWork = createUnitOfWork(pool);

    await expect(
      unitOfWork.transaction(
        () =>
          unitOfWork.transaction(async () => undefined, {
            isolation: "serializable",
          }),
        { isolation: "read-committed" },
      ),
    ).rejects.toBeInstanceOf(NestedTransactionOptionsError);
    expect(client.query.mock.calls.map(([sql]) => sql)).toContain("ROLLBACK");
  });

  it("keeps concurrent transaction scopes isolated", async () => {
    const first = createClient();
    const second = createClient();
    const { pool } = createPool([first, second]);
    const unitOfWork = createUnitOfWork(pool);
    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted!: () => void;
    const firstDidStart = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });

    const firstTransaction = unitOfWork.transaction(async (repositories) => {
      await repositories.source.query("SELECT 'first transaction'");
      firstStarted();
      await firstCanFinish;
      await unitOfWork.read(async (nestedRead) => {
        expect(nestedRead).toBe(repositories);
      });
    });
    await firstDidStart;
    const secondTransaction = unitOfWork.transaction(async (repositories) => {
      await repositories.source.query("SELECT 'second transaction'");
    });
    releaseFirst();
    await Promise.all([firstTransaction, secondTransaction]);
    expect(first.query.mock.calls.map(([sql]) => sql)).toContain(
      "SELECT 'first transaction'",
    );
    expect(second.query.mock.calls.map(([sql]) => sql)).toContain(
      "SELECT 'second transaction'",
    );
  });

  it("rejects a delayed descendant after its transaction commits", async () => {
    const client = createClient();
    const { pool } = createPool([client]);
    const unitOfWork = createUnitOfWork(pool);
    let allowDelayedRead!: () => void;
    const delayedReadCanRun = new Promise<void>((resolve) => {
      allowDelayedRead = resolve;
    });
    let delayedRead!: Promise<void>;

    await unitOfWork.transaction(async () => {
      delayedRead = (async () => {
        await delayedReadCanRun;
        await unitOfWork.read(async () => undefined);
      })();
    });
    allowDelayedRead();

    await expect(delayedRead).rejects.toBeInstanceOf(
      ClosedTransactionScopeError,
    );
    expect(client.release).toHaveBeenCalledWith(false);
  });

  it("invalidates descendants from a failed attempt before retrying", async () => {
    const first = createClient();
    const second = createClient();
    const { pool } = createPool([first, second]);
    const unitOfWork = createUnitOfWork(pool, {
      sleep: async () => undefined,
    });
    let allowStaleRead!: () => void;
    const staleReadCanRun = new Promise<void>((resolve) => {
      allowStaleRead = resolve;
    });
    let staleRead!: Promise<void>;
    let attempt = 0;

    await unitOfWork.transaction(async () => {
      attempt += 1;
      if (attempt === 1) {
        staleRead = (async () => {
          await staleReadCanRun;
          await unitOfWork.read(async () => undefined);
        })();
        throw sqlState("40001");
      }
    });
    allowStaleRead();

    await expect(staleRead).rejects.toBeInstanceOf(
      ClosedTransactionScopeError,
    );
    expect(first.release).toHaveBeenCalledWith(false);
    expect(second.release).toHaveBeenCalledWith(false);
  });

  it("blocks a captured repository from querying after client release", async () => {
    const client = createClient();
    const { pool } = createPool([client]);
    interface QueryRepository {
      query(): Promise<unknown>;
    }
    const unitOfWork = new PostgresUnitOfWork<QueryRepository>(
      () => pool,
      (source) => ({
        query: async () => source.query("SELECT 'captured repository'"),
      }),
    );
    let capturedRepository!: QueryRepository;

    await unitOfWork.transaction(async (repository) => {
      capturedRepository = repository;
    });

    await expect(capturedRepository.query()).rejects.toBeInstanceOf(
      ClosedTransactionScopeError,
    );
    expect(client.query.mock.calls.map(([sql]) => sql)).not.toContain(
      "SELECT 'captured repository'",
    );
    expect(client.release).toHaveBeenCalledWith(false);
  });

  it("closes a captured source when repository construction fails", async () => {
    const client = createClient();
    const { pool } = createPool([client]);
    const factoryFailure = new Error("repository factory failed");
    let capturedSource!: PostgresRepositorySource;
    const unitOfWork = new PostgresUnitOfWork<TestRepositories>(
      () => pool,
      (source) => {
        capturedSource = source;
        throw factoryFailure;
      },
    );

    await expect(
      unitOfWork.transaction(async () => undefined),
    ).rejects.toBe(factoryFailure);
    expect(() => capturedSource.query("SELECT 'after factory failure'")).toThrow(
      ClosedTransactionScopeError,
    );
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN ISOLATION LEVEL READ COMMITTED, READ WRITE",
      "ROLLBACK",
    ]);
    expect(client.release).toHaveBeenCalledWith(false);
  });

  it("closes a factory-captured source before rollback completes", async () => {
    let rollbackStarted!: () => void;
    const didStartRollback = new Promise<void>((resolve) => {
      rollbackStarted = resolve;
    });
    let finishRollback!: () => void;
    const rollbackCanFinish = new Promise<void>((resolve) => {
      finishRollback = resolve;
    });
    const client = createClient(async (sql) => {
      if (sql === "ROLLBACK") {
        rollbackStarted();
        await rollbackCanFinish;
      }
      return { rows: [] };
    });
    const { pool } = createPool([client]);
    const factoryFailure = new Error("repository factory failed");
    let capturedSource!: PostgresRepositorySource;
    const unitOfWork = new PostgresUnitOfWork<TestRepositories>(
      () => pool,
      (source) => {
        capturedSource = source;
        throw factoryFailure;
      },
    );

    const transaction = unitOfWork.transaction(async () => undefined);
    await didStartRollback;
    expect(() => capturedSource.query("SELECT 'during rollback'")).toThrow(
      ClosedTransactionScopeError,
    );
    finishRollback();

    await expect(transaction).rejects.toBe(factoryFailure);
    expect(client.query.mock.calls.map(([sql]) => sql)).not.toContain(
      "SELECT 'during rollback'",
    );
  });

  it("uses the pool directly for reads outside a transaction", async () => {
    const { connect, pool } = createPool([]);
    const unitOfWork = createUnitOfWork(pool);

    await unitOfWork.read(async ({ source }) => {
      expect(source).toBe(pool);
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it("destroys a client after a fatal connection error", async () => {
    const client = createClient();
    const { pool } = createPool([client]);
    const unitOfWork = createUnitOfWork(pool);

    await expect(
      unitOfWork.transaction(
        async () => {
          throw Object.assign(new Error("connection lost"), {
            code: "ECONNRESET",
          });
        },
        { maxAttempts: 1 },
      ),
    ).rejects.toMatchObject({ code: "ECONNRESET" });
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it("honors explicit isolation and read-only modes", async () => {
    const client = createClient();
    const { pool } = createPool([client]);
    const unitOfWork = createUnitOfWork(pool);

    await unitOfWork.transaction(async () => undefined, {
      isolation: "serializable",
      readOnly: true,
    });
    expect(client.query).toHaveBeenNthCalledWith(
      1,
      "BEGIN ISOLATION LEVEL SERIALIZABLE, READ ONLY",
    );
  });
});

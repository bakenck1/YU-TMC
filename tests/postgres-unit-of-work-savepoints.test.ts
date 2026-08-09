import assert from "node:assert/strict";
import test from "node:test";

import {
  ConcurrentNestedTransactionError,
  PostgresUnitOfWork,
} from "../lib/server/persistence/postgres/postgres-unit-of-work";
import type { Pool, QueryResultRow } from "pg";

test("a handled nested transaction failure rolls back to a savepoint", async () => {
  const database = new FakeDatabase();
  const unitOfWork = createUnitOfWork(database);

  const result = await unitOfWork.transaction(async (repository) => {
    await repository.execute("outer-before");
    await assert.rejects(
      unitOfWork.transaction(async (nested) => nested.execute("fail-known")),
      /known conflict/,
    );
    await repository.execute("outer-after");
    return "committed";
  });

  assert.equal(result, "committed");
  assert.deepEqual(database.statements, [
    "BEGIN ISOLATION LEVEL READ COMMITTED, READ WRITE",
    "outer-before",
    "SAVEPOINT yu_nested_1",
    "fail-known",
    "ROLLBACK TO SAVEPOINT yu_nested_1",
    "RELEASE SAVEPOINT yu_nested_1",
    "outer-after",
    "COMMIT",
  ]);
  assert.deepEqual(database.releases, [false]);
});

test("an unhandled nested failure rolls back the outer transaction", async () => {
  const database = new FakeDatabase();
  const unitOfWork = createUnitOfWork(database);

  await assert.rejects(
    unitOfWork.transaction(async () =>
      unitOfWork.transaction(async (nested) => nested.execute("fail-unknown")),
    ),
    /unknown failure/,
  );

  assert.deepEqual(database.statements, [
    "BEGIN ISOLATION LEVEL READ COMMITTED, READ WRITE",
    "SAVEPOINT yu_nested_1",
    "fail-unknown",
    "ROLLBACK TO SAVEPOINT yu_nested_1",
    "RELEASE SAVEPOINT yu_nested_1",
    "ROLLBACK",
  ]);
});

test("a failed savepoint recovery destroys the PostgreSQL client", async () => {
  const database = new FakeDatabase();
  database.failSavepointRecovery = true;
  const unitOfWork = createUnitOfWork(database);

  await assert.rejects(
    unitOfWork.transaction(async () =>
      unitOfWork.transaction(async (nested) => nested.execute("fail-known")),
    ),
    /Failed to recover a nested PostgreSQL transaction/,
  );

  assert.deepEqual(database.releases, [true]);
  assert.equal(database.statements.at(-1), "ROLLBACK");
});

test("a serializable retry returns values from the committed attempt only", async () => {
  const database = new FakeDatabase();
  database.serializationFailures = 1;
  const unitOfWork = createUnitOfWork(database);
  let generated = 0;

  const result = await unitOfWork.transaction(
    async () => `generated-${++generated}`,
    { isolation: "serializable", maxAttempts: 2 },
  );

  assert.equal(result, "generated-2");
  assert.equal(generated, 2);
  assert.deepEqual(database.statements.filter((sql) => sql.startsWith("BEGIN")), [
    "BEGIN ISOLATION LEVEL SERIALIZABLE, READ WRITE",
    "BEGIN ISOLATION LEVEL SERIALIZABLE, READ WRITE",
  ]);
  assert.deepEqual(database.releases, [false, false]);
});

test("concurrent sibling savepoints are rejected before issuing unsafe SQL", async () => {
  const database = new FakeDatabase();
  const unitOfWork = createUnitOfWork(database);
  let enterFirst!: () => void;
  let releaseFirst!: () => void;
  const firstEntered = new Promise<void>((resolve) => {
    enterFirst = resolve;
  });
  const firstReleased = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  await unitOfWork.transaction(async () => {
    const first = unitOfWork.transaction(async (repository) => {
      enterFirst();
      await firstReleased;
      await repository.execute("first-nested-complete");
    });
    await firstEntered;
    await assert.rejects(
      unitOfWork.transaction(async (repository) =>
        repository.execute("unsafe-sibling")),
      ConcurrentNestedTransactionError,
    );
    releaseFirst();
    await first;
  });

  assert.equal(database.statements.includes("unsafe-sibling"), false);
  assert.equal(
    database.statements.filter((statement) =>
      statement.startsWith("SAVEPOINT")).length,
    1,
  );
});

function createUnitOfWork(database: FakeDatabase) {
  return new PostgresUnitOfWork(
    () => database.asPool(),
    (source) => ({
      async execute(statement: string) {
        await source.query(statement);
      },
    }),
    { sleep: async () => undefined },
  );
}

class FakeDatabase {
  statements: string[] = [];
  releases: boolean[] = [];
  failSavepointRecovery = false;
  serializationFailures = 0;

  asPool() {
    return {
      connect: async () => ({
        query: async <Row extends QueryResultRow>(statement: string) => {
          this.statements.push(statement);
          if (statement === "fail-known") throw new Error("known conflict");
          if (statement === "fail-unknown") throw new Error("unknown failure");
          if (
            statement.startsWith("ROLLBACK TO SAVEPOINT") &&
            this.failSavepointRecovery
          ) {
            throw new Error("savepoint recovery failed");
          }
          if (statement === "COMMIT" && this.serializationFailures > 0) {
            this.serializationFailures -= 1;
            throw Object.assign(new Error("serialization failure"), {
              code: "40001",
            });
          }
          return { rows: [] as Row[], rowCount: 0 };
        },
        release: (destroy?: boolean) => this.releases.push(destroy === true),
      }),
    } as unknown as Pool;
  }
}

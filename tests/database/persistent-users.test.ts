import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { UserService } from "@/lib/application/services/user-service";
import { readDatabaseConfig, type DatabaseConfig } from "@/lib/db/env";
import { closeDatabase } from "@/lib/db/client";
import { migrateDatabase } from "@/lib/db/migrations";
import {
  clearDurableRateLimit,
  consumeDurableRateLimit,
} from "@/lib/security/rate-limiter";
import { createPostgresPool } from "@/lib/db/pool";
import { PostgresUnitOfWork } from "@/lib/server/persistence/postgres/postgres-unit-of-work";
import { createPostgresUserRepositories } from "@/lib/server/persistence/postgres/postgres-user-repositories";
import { ScryptPasswordHasher } from "@/lib/server/security/scrypt-password-hasher";
import type { Pool } from "pg";

let migrationConfig: DatabaseConfig;
let runtimeConfig: DatabaseConfig;
let pool: Pool;
let service: UserService;
let adminActorId = "";

describe("persistent PostgreSQL users", () => {
  beforeAll(async () => {
    migrationConfig = readDatabaseConfig({
      purpose: "migration",
      target: "test",
    });
    runtimeConfig = readDatabaseConfig({
      purpose: "runtime",
      target: "test",
    });
    await resetSchemas(migrationConfig);
    await migrateDatabase(migrationConfig);
    ({ pool, service } = createService(runtimeConfig));
  });

  afterAll(async () => {
    await pool?.end();
    await closeDatabase();
    await resetSchemas(migrationConfig);
  });

  it("permits exactly one concurrent bootstrap and survives a pool restart", async () => {
    const registrations = await Promise.all([
      service.registerFirstAdmin({
        email: "first@example.com",
        name: "First Admin",
        password: "First-Database-Password-2026!",
      }),
      service.registerFirstAdmin({
        email: "second@example.com",
        name: "Second Admin",
        password: "Second-Database-Password-2026!",
      }),
    ]);
    expect(registrations.filter(Boolean)).toHaveLength(1);
    const winner = registrations.find(Boolean)!;
    const password =
      winner.email === "first@example.com"
        ? "First-Database-Password-2026!"
        : "Second-Database-Password-2026!";

    await pool.end();
    ({ pool, service } = createService(runtimeConfig));
    adminActorId = (
      await service.resolveCurrentAccount(winner.email)
    )!.userId;
    await expect(service.authenticate(winner.email, password)).resolves.toEqual({
      status: "authenticated",
      sessionVersion: 1,
      user: winner,
    });
  });

  it("assigns unique server codes and enforces normalized unique email", async () => {
    const created = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        service.createUser({
          email: `user-${index}@example.com`,
          fullName: `User ${index}`,
          role: "employee",
        }, adminActorId),
      ),
    );
    expect(new Set(created.map((user) => user.code)).size).toBe(created.length);
    await expect(
      service.createUser({
        email: " USER-0@EXAMPLE.COM ",
        fullName: "Duplicate User",
        role: "employee",
      }, adminActorId),
    ).rejects.toMatchObject({ publicCode: "email_already_exists" });
  });

  it("keeps at least one active admin under concurrent deactivation", async () => {
    const second = await service.createUser({
      email: "another-admin@example.com",
      fullName: "Another Admin",
      role: "admin",
      initialPassword: "Another-Admin-Password-2026!",
    }, adminActorId);
    const activeSecond = await service.updateUser(second.id, {
      fullName: second.fullName,
      phone: second.phone,
      role: second.role,
      emailVerified: second.emailVerified,
      active: true,
      version: second.version,
    }, adminActorId);
    const first = (await service.listUsers()).find(
      (user) => user.role === "admin" && user.id !== activeSecond.id,
    )!;

    const results = await Promise.allSettled([
      service.updateUser(first.id, {
        fullName: first.fullName,
        phone: first.phone,
        role: first.role,
        emailVerified: first.emailVerified,
        active: false,
        version: first.version,
      }, adminActorId),
      service.updateUser(activeSecond.id, {
        fullName: activeSecond.fullName,
        phone: activeSecond.phone,
        role: activeSecond.role,
        emailVerified: activeSecond.emailVerified,
        active: false,
        version: activeSecond.version,
      }, adminActorId),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );
    const activeAdmins = (await service.listUsers()).filter(
      (user) => user.role === "admin" && user.active,
    );
    expect(activeAdmins).toHaveLength(1);
    adminActorId = activeAdmins[0]!.id;
  });

  it("cannot race employee authorization against an admin promotion", async () => {
    const employee = await service.createUser({
      email: "race-employee@example.com",
      fullName: "Race Employee",
      role: "employee",
      active: true,
      initialPassword: "Race-Owner-Password-2026!",
    }, adminActorId);
    const target = await service.createUser({
      email: "promotion-race@example.com",
      fullName: "Promotion Race",
      role: "employee",
    }, adminActorId);

    const [promotion, ownerMutation] = await Promise.allSettled([
      service.updateUser(target.id, {
        fullName: target.fullName,
        phone: target.phone,
        role: "admin",
        emailVerified: target.emailVerified,
        active: target.active,
        version: target.version,
      }, adminActorId),
      service.updateUser(target.id, {
        fullName: "Owner overwrite",
        phone: target.phone,
        role: "employee",
        emailVerified: target.emailVerified,
        active: target.active,
        version: target.version + 1,
      }, employee.id),
    ]);

    expect(promotion.status).toBe("fulfilled");
    expect(ownerMutation.status).toBe("rejected");
    expect(
      (await service.listUsers()).find((user) => user.id === target.id),
    ).toMatchObject({ role: "admin", fullName: target.fullName });
  });

  it("reloads actor authority after a concurrent demotion commits", async () => {
    const actor = await service.createUser({
      email: "concurrent-actor@example.com",
      fullName: "Concurrent Actor",
      role: "admin",
      active: true,
      initialPassword: "Concurrent-Actor-Password-2026!",
    }, adminActorId);
    const client = await pool.connect();
    let committed = false;
    try {
      await client.query("begin");
      await client.query(
        `update "yu_inventory"."users"
         set role = 'employee', version = version + 1
         where id = $1`,
        [actor.id],
      );
      const mutation = service.createUser({
        email: "must-not-exist@example.com",
        fullName: "Must Not Exist",
        role: "employee",
      }, actor.id);
      await new Promise<void>((resolve) => setImmediate(resolve));
      await client.query("commit");
      committed = true;

      await expect(mutation).rejects.toMatchObject({
        publicCode: "forbidden",
      });
      expect(
        (await service.listUsers()).some(
          (user) => user.email === "must-not-exist@example.com",
        ),
      ).toBe(false);
    } finally {
      if (!committed) await client.query("rollback");
      client.release();
    }
  });

  it("keeps credentials attached to committed users", async () => {
    const database = createPostgresPool(migrationConfig, { max: 1 });
    try {
      const result = await database.query<{
        users: number;
        orphanCredentials: number;
        bootstrap: number;
      }>(
        `select
          (select count(*)::int from "yu_inventory"."users") as users,
          (select count(*)::int
             from "yu_inventory"."user_password_credentials" credential
             left join "yu_inventory"."users" app_user on app_user.id = credential.user_id
            where app_user.id is null) as "orphanCredentials",
          (select count(*)::int from "yu_inventory"."auth_bootstrap"
            where completed_at is not null) as bootstrap`,
      );
      expect(result.rows[0]).toMatchObject({
        orphanCredentials: 0,
        bootstrap: 1,
      });
      expect(result.rows[0]!.users).toBeGreaterThan(1);
    } finally {
      await database.end();
    }
  });


  it("grants runtime deletion only for ephemeral security data", async () => {
    const database = createPostgresPool(runtimeConfig, { max: 1 });
    try {
      const result = await database.query<{
        passwordReset: boolean;
        rateLimits: boolean;
        users: boolean;
      }>(
        `select
          has_table_privilege(current_user, 'yu_inventory.password_reset_challenges', 'DELETE') as "passwordReset",
          has_table_privilege(current_user, 'yu_inventory.security_rate_limits', 'DELETE') as "rateLimits",
          has_table_privilege(current_user, 'yu_inventory.users', 'DELETE') as users`,
      );
      expect(result.rows[0]).toEqual({
        passwordReset: true,
        rateLimits: true,
        users: false,
      });
    } finally {
      await database.end();
    }
  });

  it("enforces and clears a durable cross-instance rate limit", async () => {
    const options = {
      namespace: "integration-login",
      key: randomUUID(),
      limit: 2,
      windowMs: 60_000,
    };
    await expect(consumeDurableRateLimit(options)).resolves.toMatchObject({
      allowed: true,
      remaining: 1,
    });
    await expect(consumeDurableRateLimit(options)).resolves.toMatchObject({
      allowed: true,
      remaining: 0,
    });
    await expect(consumeDurableRateLimit(options)).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
    });
    await clearDurableRateLimit(options.namespace, options.key);
    await expect(consumeDurableRateLimit(options)).resolves.toMatchObject({
      allowed: true,
      remaining: 1,
    });
  });
});

function createService(config: DatabaseConfig) {
  const createdPool = createPostgresPool(config, { max: 4 });
  return {
    pool: createdPool,
    service: new UserService(
      new PostgresUnitOfWork(
        () => createdPool,
        createPostgresUserRepositories,
      ),
      new ScryptPasswordHasher(),
      { now: () => new Date() },
      { create: () => randomUUID() },
    ),
  };
}

async function resetSchemas(config: DatabaseConfig) {
  if (!config.databaseName.toLowerCase().endsWith("_test")) {
    throw new Error("Refusing to reset a database without the _test suffix.");
  }
  const resetPool = createPostgresPool(config, { max: 1 });
  try {
    await resetPool.query('drop schema if exists "yu_migrations" cascade');
    await resetPool.query('drop schema if exists "yu_inventory" cascade');
  } finally {
    await resetPool.end();
  }
}

import { describe, expect, it } from "vitest";

import type {
  PasswordHash,
  PasswordHasher,
} from "@/lib/application/ports/password-hasher";
import { UserService } from "@/lib/application/services/user-service";
import { ApplicationError } from "@/lib/domain/application-error";
import { MemoryUserUnitOfWork } from "@/lib/server/persistence/memory/memory-user-unit-of-work";

const ADMIN_USER_ID = "00000000-0000-4000-8000-000000000001";

class DeterministicPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<PasswordHash> {
    return { salt: "deterministic-test-salt", hash: bytes(password) };
  }

  async verify(
    password: string,
    credential: { salt: string; hash: Uint8Array } | null,
  ): Promise<boolean> {
    return (
      credential !== null &&
      Buffer.from(credential.hash).equals(Buffer.from(bytes(password)))
    );
  }
}

function createService() {
  let id = 0;
  let instant = 0;
  return new UserService(
    new MemoryUserUnitOfWork(),
    new DeterministicPasswordHasher(),
    { now: () => new Date(Date.UTC(2026, 6, 28, 0, 0, instant++)) },
    { create: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}` },
  );
}

describe("UserService", () => {
  it("allows exactly one concurrent first-admin registration", async () => {
    const service = createService();
    const outcomes = await Promise.all([
      service.registerFirstAdmin({
        email: "First@Example.com",
        name: "First Admin",
        password: "first-password",
      }),
      service.registerFirstAdmin({
        email: "second@example.com",
        name: "Second Admin",
        password: "second-password",
      }),
    ]);

    expect(outcomes.filter(Boolean)).toHaveLength(1);
    await expect(service.listUsers()).resolves.toHaveLength(1);
    await expect(service.isConfigured()).resolves.toBe(true);
  });

  it("keeps profile email immutable and creates credentialless users inactive", async () => {
    const service = createService();
    await registerAdmin(service);

    const created = await service.createUser({
      email: " Staff@Example.com ",
      fullName: " Staff Member ",
      role: "employee",
      active: true,
    }, ADMIN_USER_ID);

    expect(created).toMatchObject({
      email: "staff@example.com",
      fullName: "Staff Member",
      active: false,
      version: 1,
    });
    await expect(
      service.authenticate("staff@example.com", "anything"),
    ).resolves.toEqual({ status: "invalid" });
    await expect(
      service.updateUser(created.id, {
        fullName: created.fullName,
        phone: created.phone,
        role: created.role,
        emailVerified: created.emailVerified,
        active: true,
        version: created.version,
      }, ADMIN_USER_ID),
    ).rejects.toMatchObject({ publicCode: "user_login_not_configured" });

    const configured = await service.updateUser(created.id, {
      fullName: created.fullName,
      phone: created.phone,
      role: created.role,
      emailVerified: created.emailVerified,
      active: true,
      version: created.version,
      initialPassword: "Configured-Later-Password-2026!",
    }, ADMIN_USER_ID);
    expect(configured.active).toBe(true);
    await expect(
      service.authenticate(
        created.email,
        "Configured-Later-Password-2026!",
      ),
    ).resolves.toMatchObject({ status: "authenticated" });
  });

  it("rejects duplicate case-insensitive email and stale updates", async () => {
    const service = createService();
    await registerAdmin(service);
    const created = await service.createUser({
      email: "staff@example.com",
      fullName: "Staff Member",
      role: "employee",
    }, ADMIN_USER_ID);

    await expect(
      service.createUser({
        email: " STAFF@example.com ",
        fullName: "Other Member",
        role: "employee",
      }, ADMIN_USER_ID),
    ).rejects.toMatchObject({
      publicCode: "email_already_exists",
    });

    await service.updateUser(created.id, {
      fullName: created.fullName,
      phone: created.phone,
      role: created.role,
      emailVerified: created.emailVerified,
      active: false,
      version: created.version,
    }, ADMIN_USER_ID);
    await expect(
      service.updateUser(created.id, {
        fullName: "Stale Edit",
        phone: null,
        role: "employee",
        emailVerified: false,
        active: false,
        version: created.version,
      }, ADMIN_USER_ID),
    ).rejects.toMatchObject({ publicCode: "user_version_conflict" });
  });

  it("stores an initial password atomically before allowing activation", async () => {
    const service = createService();
    await registerAdmin(service);
    const created = await service.createUser({
      email: "ready@example.com",
      fullName: "Ready User",
      role: "employee",
      active: true,
      initialPassword: "Ready-User-Password-2026!",
    }, ADMIN_USER_ID);

    expect(created.active).toBe(true);
    await expect(
      service.authenticate(
        "ready@example.com",
        "Ready-User-Password-2026!",
      ),
    ).resolves.toMatchObject({
      status: "authenticated",
      user: { email: "ready@example.com" },
    });
  });

  it("rechecks privileged target roles inside the mutation transaction", async () => {
    const service = createService();
    await registerAdmin(service);
    const owner = await service.createUser({
      email: "owner@example.com",
      fullName: "Active Owner",
      role: "owner",
      active: true,
      initialPassword: "Owner-Test-Password-2026!",
    }, ADMIN_USER_ID);
    const employee = await service.createUser({
      email: "future-version@example.com",
      fullName: "Future Version",
      role: "employee",
    }, ADMIN_USER_ID);
    const promoted = await service.updateUser(employee.id, {
      fullName: employee.fullName,
      phone: employee.phone,
      role: "admin",
      emailVerified: employee.emailVerified,
      active: employee.active,
      version: employee.version,
    }, ADMIN_USER_ID);

    await expect(
      service.updateUser(promoted.id, {
        fullName: "Owner overwrite",
        phone: promoted.phone,
        role: "employee",
        emailVerified: promoted.emailVerified,
        active: promoted.active,
        version: promoted.version,
      }, owner.id),
    ).rejects.toMatchObject({ publicCode: "forbidden" });
    await expect(
      service.deleteUser(promoted.id, promoted.version, owner.id),
    ).rejects.toMatchObject({ publicCode: "forbidden" });
  });

  it("reloads the actor by immutable id inside each mutation transaction", async () => {
    const service = createService();
    await registerAdmin(service);
    const secondAdmin = await service.createUser({
      email: "authority-admin@example.com",
      fullName: "Authority Admin",
      role: "admin",
      active: true,
      initialPassword: "Authority-Admin-Password-2026!",
    }, ADMIN_USER_ID);
    const originalAdmin = (await service.listUsers()).find(
      (user) => user.id === ADMIN_USER_ID,
    )!;
    await service.updateUser(originalAdmin.id, {
      fullName: originalAdmin.fullName,
      phone: originalAdmin.phone,
      role: "employee",
      emailVerified: originalAdmin.emailVerified,
      active: originalAdmin.active,
      version: originalAdmin.version,
    }, secondAdmin.id);

    await expect(
      service.createUser({
        email: "stale-authority@example.com",
        fullName: "Stale Authority",
        role: "employee",
      }, ADMIN_USER_ID),
    ).rejects.toMatchObject({ publicCode: "forbidden" });
  });

  it("never deactivates, demotes or deletes the last active admin", async () => {
    const service = createService();
    await registerAdmin(service);
    const admin = (await service.listUsers())[0]!;

    const attempts = [
      () =>
        service.updateUser(admin.id, {
          fullName: admin.fullName,
          phone: admin.phone,
          role: "employee",
          emailVerified: admin.emailVerified,
          active: true,
          version: admin.version,
        }, ADMIN_USER_ID),
      () =>
        service.updateUser(admin.id, {
          fullName: admin.fullName,
          phone: admin.phone,
          role: admin.role,
          emailVerified: admin.emailVerified,
          active: false,
          version: admin.version,
        }, ADMIN_USER_ID),
      () => service.deleteUser(admin.id, admin.version, ADMIN_USER_ID),
    ];

    for (const attempt of attempts) {
      await expect(attempt()).rejects.toMatchObject({
        publicCode: "last_active_admin",
      });
    }
  });

  it("invalidates a session subject immediately after deactivation", async () => {
    const service = createService();
    await registerAdmin(service);
    const second = await service.createUser({
      email: "second@example.com",
      fullName: "Second Admin",
      role: "admin",
      initialPassword: "Second-Admin-Password-2026!",
    }, ADMIN_USER_ID);
    const activeSecond = await service.updateUser(second.id, {
      fullName: second.fullName,
      phone: second.phone,
      role: second.role,
      emailVerified: second.emailVerified,
      active: true,
      version: second.version,
    }, ADMIN_USER_ID);
    expect(
      await service.resolveSessionSubject(activeSecond.email),
    ).not.toBeNull();

    await service.updateUser(activeSecond.id, {
      fullName: activeSecond.fullName,
      phone: activeSecond.phone,
      role: activeSecond.role,
      emailVerified: activeSecond.emailVerified,
      active: false,
      version: activeSecond.version,
    }, ADMIN_USER_ID);
    await expect(
      service.resolveSessionSubject(activeSecond.email),
    ).resolves.toBeNull();
  });

  it("imports a legacy hash idempotently and rejects conflicting reruns", async () => {
    const service = createService();
    const input = {
      email: "legacy@example.com",
      name: "Legacy Admin",
      role: "owner" as const,
      blocked: false,
      salt: "legacy-salt-value",
      hash: bytes("legacy-password"),
    };

    await expect(service.importLegacyCredential(input)).resolves.toBe("imported");
    await expect(service.importLegacyCredential(input)).resolves.toBe(
      "already_imported",
    );
    await expect(
      service.importLegacyCredential({
        ...input,
        hash: bytes("changed-password"),
      }),
    ).rejects.toBeInstanceOf(ApplicationError);
    await expect(
      service.authenticate(input.email, "legacy-password"),
    ).resolves.toMatchObject({
      status: "authenticated",
      user: { role: "owner" },
    });
  });
});

async function registerAdmin(service: UserService) {
  await service.registerFirstAdmin({
    email: "admin@example.com",
    name: "Admin User",
    password: "admin-password",
  });
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

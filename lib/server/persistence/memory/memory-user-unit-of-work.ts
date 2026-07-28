import "server-only";

import type { UnitOfWork } from "@/lib/application/ports/unit-of-work";
import type {
  AuthBootstrapRepository,
  InsertPasswordCredential,
  InsertUserRecord,
  PasswordCredentialRecord,
  PasswordCredentialRepository,
  UpdateUserRecord,
  UserRecord,
  UserRepositories,
  UserRepository,
} from "@/lib/application/ports/user-repositories";
import { ApplicationError } from "@/lib/domain/application-error";

interface MemoryState {
  users: Map<string, UserRecord>;
  credentials: Map<string, PasswordCredentialRecord>;
  bootstrap: { completedAt: Date | null; firstAdminUserId: string | null };
  nextCode: number;
}

export class MemoryUserUnitOfWork implements UnitOfWork<UserRepositories> {
  private state = emptyState();
  private transactionTail: Promise<void> = Promise.resolve();

  read<Result>(
    work: (repositories: UserRepositories) => Promise<Result>,
  ): Promise<Result> {
    return work(createRepositories(this.state));
  }

  async transaction<Result>(
    work: (repositories: UserRepositories) => Promise<Result>,
  ): Promise<Result> {
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    try {
      const draft = cloneState(this.state);
      const result = await work(createRepositories(draft));
      this.state = draft;
      return result;
    } finally {
      release();
    }
  }

  reset(): void {
    this.state = emptyState();
    this.transactionTail = Promise.resolve();
  }
}

function createRepositories(state: MemoryState): UserRepositories {
  return {
    users: new MemoryUserRepository(state),
    credentials: new MemoryPasswordCredentialRepository(state),
    bootstrap: new MemoryAuthBootstrapRepository(state),
  };
}

class MemoryUserRepository implements UserRepository {
  constructor(private readonly state: MemoryState) {}

  async list(): Promise<UserRecord[]> {
    return [...this.state.users.values()]
      .map(cloneUser)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async findById(id: string): Promise<UserRecord | null> {
    const user = this.state.users.get(id);
    return user ? cloneUser(user) : null;
  }

  async findByNormalizedEmail(email: string): Promise<UserRecord | null> {
    const user = [...this.state.users.values()].find(
      (candidate) => candidate.email === email,
    );
    return user ? cloneUser(user) : null;
  }

  async insert(input: InsertUserRecord): Promise<UserRecord> {
    if (
      [...this.state.users.values()].some(
        (candidate) => candidate.email === input.email,
      )
    ) {
      throw new ApplicationError("conflict", "email_already_exists");
    }
    const code = `USR-${String(this.state.nextCode).padStart(6, "0")}`;
    this.state.nextCode += 1;
    const user: UserRecord = {
      ...input,
      code,
      version: 1,
      updatedAt: input.createdAt,
      deactivatedAt: input.active ? null : input.createdAt,
      deletedAt: null,
    };
    this.state.users.set(user.id, cloneUser(user));
    return cloneUser(user);
  }

  async update(input: UpdateUserRecord): Promise<UserRecord | null> {
    const current = this.state.users.get(input.id);
    if (
      !current ||
      current.deletedAt ||
      current.version !== input.expectedVersion
    ) {
      return null;
    }
    const updated: UserRecord = {
      ...current,
      fullName: input.fullName,
      role: input.role,
      phone: input.phone,
      emailVerified: input.emailVerified,
      active: input.active,
      version: current.version + 1,
      updatedAt: input.updatedAt,
      deactivatedAt: input.active
        ? null
        : (current.deactivatedAt ?? input.updatedAt),
    };
    this.state.users.set(input.id, cloneUser(updated));
    return cloneUser(updated);
  }

  async softDelete(
    id: string,
    expectedVersion: number,
    deletedAt: Date,
  ): Promise<UserRecord | null> {
    const current = this.state.users.get(id);
    if (!current || current.deletedAt || current.version !== expectedVersion) {
      return null;
    }
    const deleted: UserRecord = {
      ...current,
      active: false,
      version: current.version + 1,
      updatedAt: deletedAt,
      deactivatedAt: current.deactivatedAt ?? deletedAt,
      deletedAt,
    };
    this.state.users.set(id, cloneUser(deleted));
    return cloneUser(deleted);
  }

  async countActiveAdminsForUpdate(): Promise<number> {
    return [...this.state.users.values()].filter(
      (user) => user.role === "admin" && user.active && !user.deletedAt,
    ).length;
  }
}

class MemoryPasswordCredentialRepository
  implements PasswordCredentialRepository
{
  constructor(private readonly state: MemoryState) {}

  async findByUserId(userId: string): Promise<PasswordCredentialRecord | null> {
    const credential = this.state.credentials.get(userId);
    return credential ? cloneCredential(credential) : null;
  }

  async insert(input: InsertPasswordCredential): Promise<void> {
    if (this.state.credentials.has(input.userId)) {
      throw new ApplicationError("conflict", "credential_already_exists");
    }
    this.state.credentials.set(input.userId, cloneCredential(input));
  }

  async replace(input: InsertPasswordCredential): Promise<boolean> {
    if (!this.state.credentials.has(input.userId)) return false;
    this.state.credentials.set(input.userId, cloneCredential(input));
    return true;
  }
}

class MemoryAuthBootstrapRepository implements AuthBootstrapRepository {
  constructor(private readonly state: MemoryState) {}

  async isComplete(): Promise<boolean> {
    return this.state.bootstrap.completedAt !== null;
  }

  async lockAndRead(): Promise<{ complete: boolean }> {
    return { complete: this.state.bootstrap.completedAt !== null };
  }

  async complete(firstAdminUserId: string, completedAt: Date): Promise<void> {
    if (this.state.bootstrap.completedAt) {
      throw new ApplicationError("conflict", "registration_closed");
    }
    this.state.bootstrap = { completedAt, firstAdminUserId };
  }
}

function emptyState(): MemoryState {
  return {
    users: new Map(),
    credentials: new Map(),
    bootstrap: { completedAt: null, firstAdminUserId: null },
    nextCode: 1,
  };
}

function cloneState(state: MemoryState): MemoryState {
  return {
    users: new Map(
      [...state.users].map(([id, user]) => [id, cloneUser(user)]),
    ),
    credentials: new Map(
      [...state.credentials].map(([id, credential]) => [
        id,
        cloneCredential(credential),
      ]),
    ),
    bootstrap: {
      completedAt: state.bootstrap.completedAt
        ? new Date(state.bootstrap.completedAt)
        : null,
      firstAdminUserId: state.bootstrap.firstAdminUserId,
    },
    nextCode: state.nextCode,
  };
}

function cloneUser(user: UserRecord): UserRecord {
  return {
    ...user,
    createdAt: new Date(user.createdAt),
    updatedAt: new Date(user.updatedAt),
    deactivatedAt: user.deactivatedAt
      ? new Date(user.deactivatedAt)
      : null,
    deletedAt: user.deletedAt ? new Date(user.deletedAt) : null,
  };
}

function cloneCredential(
  credential: InsertPasswordCredential | PasswordCredentialRecord,
): PasswordCredentialRecord {
  return {
    ...credential,
    hash: new Uint8Array(credential.hash),
    updatedAt: new Date(credential.updatedAt),
  };
}

import type {
  CreateUserInput,
  UpdateUserInput,
  UserDto,
  UserRole,
} from "@/lib/contracts/users";
import { ApplicationError } from "@/lib/domain/application-error";
import type { UnitOfWork } from "@/lib/application/ports/unit-of-work";
import type {
  PasswordCredentialRecord,
  UserRecord,
  UserRepositories,
} from "@/lib/application/ports/user-repositories";
import type { PasswordHasher } from "@/lib/application/ports/password-hasher";
import { canManageUser } from "@/lib/security/permissions";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DUMMY_USER_ID = "00000000-0000-0000-0000-000000000000";

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  create(): string;
}

export interface AuthenticatedAccount {
  email: string;
  name: string;
  role: UserRole;
}

export interface CurrentAccount extends AuthenticatedAccount {
  userId: string;
}

export type AuthenticationResult =
  | { status: "authenticated"; user: AuthenticatedAccount }
  | { status: "blocked" }
  | { status: "invalid" };

export class UserService {
  constructor(
    private readonly unitOfWork: UnitOfWork<UserRepositories>,
    private readonly passwordHasher: PasswordHasher,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async isConfigured(): Promise<boolean> {
    return this.unitOfWork.read(async ({ bootstrap }) =>
      bootstrap.isComplete(),
    );
  }

  async authenticate(
    emailInput: string,
    password: string,
  ): Promise<AuthenticationResult> {
    const email = normalizeUserEmail(emailInput);
    const account = await this.unitOfWork.read(async (repositories) => {
      const user = email
        ? await repositories.users.findByNormalizedEmail(email)
        : null;
      const credential = await repositories.credentials.findByUserId(
        user?.id ?? DUMMY_USER_ID,
      );
      return { credential, user };
    });
    const passwordMatches = await this.passwordHasher.verify(
      password,
      account.credential,
    );

    if (!passwordMatches || !account.user || account.user.deletedAt) {
      return { status: "invalid" };
    }
    if (!account.user.active) {
      return { status: "blocked" };
    }
    return {
      status: "authenticated",
      user: authenticatedAccount(account.user),
    };
  }

  async authenticateGoogleIdentity(
    input: { subject: string; email: string; name?: string | null },
  ): Promise<AuthenticationResult> {
    let email: string;
    try {
      email = requireEmail(input.email);
    } catch {
      return { status: "invalid" };
    }
    const subject = input.subject.trim();
    if (!isWorkspaceEmail(email) || !subject || subject.length > 255) {
      return { status: "invalid" };
    }

    return this.unitOfWork.transaction(
      async ({ users, externalIdentities }) => {
        await externalIdentities.lockProvisioning("google", subject, email);
        let user = await externalIdentities.findUserBySubject(
          "google",
          subject,
        );
        if (!user) {
          user = await users.findByNormalizedEmailForUpdate(email);
          if (!user) {
            const createdAt = this.clock.now();
            user = await users.insert({
              id: this.ids.create(),
              email,
              fullName: externalIdentityName(input.name, email),
              role: "employee",
              phone: null,
              emailVerified: true,
              active: true,
              createdAt,
            });
          } else {
            if (user.deletedAt) return { status: "invalid" };
            if (!user.active) return { status: "blocked" };
          }

          const existingIdentity = await externalIdentities.findByUser(
            "google",
            user.id,
          );
          if (existingIdentity && existingIdentity.subject !== subject) {
            return { status: "invalid" };
          }
          if (!existingIdentity) {
            try {
              await externalIdentities.insert({
                provider: "google",
                subject,
                userId: user.id,
                emailAtLink: email,
                createdAt: this.clock.now(),
              });
            } catch (error) {
              if (
                error instanceof ApplicationError &&
                error.kind === "conflict"
              ) {
                return { status: "invalid" };
              }
              throw error;
            }
          }
        }

        if (user.deletedAt) return { status: "invalid" };
        if (!user.active) return { status: "blocked" };
        return {
          status: "authenticated",
          user: authenticatedAccount(user),
        };
      },
      { isolation: "read-committed" },
    );
  }

  async resolveSessionSubject(
    subject: string,
  ): Promise<AuthenticatedAccount | null> {
    const user = await this.resolveCurrentAccount(subject);
    return user
      ? { email: user.email, name: user.name, role: user.role }
      : null;
  }

  async resolveCurrentAccount(
    subject: string,
  ): Promise<CurrentAccount | null> {
    const email = normalizeUserEmail(subject);
    if (!email) return null;

    return this.unitOfWork.read(async ({ users }) => {
      const user = await users.findByNormalizedEmail(email);
      return user && user.active && !user.deletedAt
        ? currentAccount(user)
        : null;
    });
  }

  async registerFirstAdmin(input: {
    email: string;
    name: string;
    password: string;
  }): Promise<AuthenticatedAccount | null> {
    const email = requireEmail(input.email);
    const fullName = requireName(input.name);
    const id = this.ids.create();
    const createdAt = this.clock.now();
    const passwordHash = await this.passwordHasher.hash(input.password);

    return this.unitOfWork.transaction(
      async (repositories) => {
        const bootstrap = await repositories.bootstrap.lockAndRead();
        if (bootstrap.complete) return null;

        const user = await repositories.users.insert({
          id,
          email,
          fullName,
          role: "admin",
          phone: null,
          emailVerified: true,
          active: true,
          createdAt,
        });
        await repositories.credentials.insert({
          userId: user.id,
          ...passwordHash,
          updatedAt: createdAt,
        });
        await repositories.bootstrap.complete(user.id, createdAt);
        return authenticatedAccount(user);
      },
      { isolation: "serializable", maxAttempts: 3 },
    );
  }

  async importLegacyCredential(input: {
    email: string;
    name: string;
    role: UserRole;
    blocked: boolean;
    salt: string;
    hash: Uint8Array;
  }): Promise<"imported" | "already_imported"> {
    const email = requireEmail(input.email);
    const fullName = requireName(input.name);
    const id = this.ids.create();
    const importedAt = this.clock.now();

    return this.unitOfWork.transaction(
      async (repositories) => {
        const bootstrap = await repositories.bootstrap.lockAndRead();
        if (bootstrap.complete) {
          const existing =
            await repositories.users.findByNormalizedEmail(email);
          const credential = existing
            ? await repositories.credentials.findByUserId(existing.id)
            : null;
          if (
            existing &&
            credential &&
            existing.fullName === fullName &&
            existing.role === input.role &&
            existing.active === !input.blocked &&
            credential.salt === input.salt &&
            equalBytes(credential.hash, input.hash)
          ) {
            return "already_imported";
          }
          throw new ApplicationError("conflict", "legacy_credential_conflict");
        }

        const user = await repositories.users.insert({
          id,
          email,
          fullName,
          role: input.role,
          phone: null,
          emailVerified: true,
          active: !input.blocked,
          createdAt: importedAt,
        });
        await repositories.credentials.insert({
          userId: user.id,
          salt: input.salt,
          hash: input.hash,
          updatedAt: importedAt,
        });
        await repositories.bootstrap.complete(user.id, importedAt);
        return "imported";
      },
      { isolation: "serializable", maxAttempts: 3 },
    );
  }

  async updatePassword(emailInput: string, password: string): Promise<boolean> {
    const email = normalizeUserEmail(emailInput);
    if (!email) return false;

    const passwordHash = await this.passwordHasher.hash(password);
    return this.unitOfWork.transaction(async (repositories) => {
      const user = await repositories.users.findByNormalizedEmail(email);
      if (!user || !user.active || user.deletedAt) return false;
      return repositories.credentials.replace({
        userId: user.id,
        ...passwordHash,
        updatedAt: this.clock.now(),
      });
    });
  }

  async findPasswordResetRecipient(
    emailInput: string,
  ): Promise<AuthenticatedAccount | null> {
    return this.resolveSessionSubject(emailInput);
  }

  async listUsers(): Promise<UserDto[]> {
    return this.unitOfWork.read(async ({ users }) =>
      (await users.list())
        .filter((user) => !user.deletedAt)
        .map(toUserDto),
    );
  }

  async getProfile(userId: string): Promise<UserDto> {
    const user = await this.unitOfWork.read(({ users }) => users.findById(userId));
    if (!user || user.deletedAt || !user.active) {
      throw new ApplicationError("not_found", "user_not_found");
    }
    return toUserDto(user);
  }

  async createUser(
    input: CreateUserInput,
    actorUserId: string,
  ): Promise<UserDto> {
    const id = this.ids.create();
    const createdAt = this.clock.now();
    const email = requireEmail(input.email);
    const fullName = requireName(input.fullName);
    const phone = normalizePhone(input.phone);
    const initialPassword = normalizeInitialPassword(input.initialPassword);
    const passwordHash = initialPassword
      ? await this.passwordHasher.hash(initialPassword)
      : null;
    if (input.active === true && !passwordHash && !isWorkspaceEmail(email)) {
      throw new ApplicationError("conflict", "user_login_not_configured");
    }

    return this.unitOfWork.transaction(async ({ users, credentials }) => {
      const actor = await requireActiveActor(users, actorUserId);
      if (!canManageUser(actor.role, { nextRole: input.role })) {
        throw new ApplicationError("forbidden", "forbidden");
      }
      if (await users.findByNormalizedEmail(email)) {
        throw new ApplicationError("conflict", "email_already_exists");
      }
      const user = await users.insert({
        id,
        email,
        fullName,
        phone,
        role: input.role,
        emailVerified: input.emailVerified === true,
        active: input.active === true,
        createdAt,
      });
      if (passwordHash) {
        await credentials.insert({
          userId: user.id,
          ...passwordHash,
          updatedAt: createdAt,
        });
      }
      return toUserDto(user);
    });
  }

  async updateUser(
    id: string,
    input: UpdateUserInput,
    actorUserId: string,
  ): Promise<UserDto> {
    const fullName = requireName(input.fullName);
    const phone = normalizePhone(input.phone);
    const initialPassword = normalizeInitialPassword(input.initialPassword);
    const passwordHash = initialPassword
      ? await this.passwordHasher.hash(initialPassword)
      : null;

    return this.unitOfWork.transaction(async (repositories) => {
      const { users } = repositories;
      const actor = await requireActiveActor(users, actorUserId);
      const current = await users.findByIdForUpdate(id);
      if (!current || current.deletedAt) {
        throw new ApplicationError("not_found", "user_not_found");
      }
      if (
        !canManageUser(actor.role, {
          currentRole: current.role,
          nextRole: input.role,
        })
      ) {
        throw new ApplicationError("forbidden", "forbidden");
      }
      if (
        current.role === "admin" &&
        current.active &&
        (input.role !== "admin" || !input.active)
      ) {
        await assertAnotherActiveAdmin(users);
      }
      const existingCredential =
        await repositories.credentials.findByUserId(current.id);
      if (
        !current.active &&
        input.active &&
        !existingCredential &&
        !passwordHash &&
        !isWorkspaceEmail(current.email)
      ) {
        throw new ApplicationError("conflict", "user_login_not_configured");
      }
      if (passwordHash) {
        const credentialInput = {
          userId: current.id,
          ...passwordHash,
          updatedAt: this.clock.now(),
        };
        if (existingCredential) {
          await repositories.credentials.replace(credentialInput);
        } else {
          await repositories.credentials.insert(credentialInput);
        }
      }
      const updated = await users.update({
        id,
        fullName,
        phone,
        role: input.role,
        emailVerified: input.emailVerified,
        active: input.active,
        expectedVersion: input.version,
        updatedAt: this.clock.now(),
      });
      if (!updated) {
        throw new ApplicationError("conflict", "user_version_conflict");
      }
      return toUserDto(updated);
    });
  }

  async deleteUser(
    id: string,
    version: number,
    actorUserId: string,
  ): Promise<void> {
    await this.unitOfWork.transaction(async ({ users }) => {
      const actor = await requireActiveActor(users, actorUserId);
      const current = await users.findByIdForUpdate(id);
      if (!current || current.deletedAt) {
        throw new ApplicationError("not_found", "user_not_found");
      }
      if (!canManageUser(actor.role, { currentRole: current.role })) {
        throw new ApplicationError("forbidden", "forbidden");
      }
      if (current.role === "admin" && current.active) {
        await assertAnotherActiveAdmin(users);
      }
      const deleted = await users.softDelete(id, version, this.clock.now());
      if (!deleted) {
        throw new ApplicationError("conflict", "user_version_conflict");
      }
    });
  }
}

async function assertAnotherActiveAdmin(
  users: UserRepositories["users"],
): Promise<void> {
  if ((await users.countActiveAdminsForUpdate()) <= 1) {
    throw new ApplicationError("conflict", "last_active_admin");
  }
}

async function requireActiveActor(
  users: UserRepositories["users"],
  actorUserId: string,
): Promise<UserRecord> {
  const actor = await users.findByIdForUpdate(actorUserId);
  if (!actor || !actor.active || actor.deletedAt) {
    throw new ApplicationError("unauthorized", "unauthorized");
  }
  return actor;
}

function authenticatedAccount(user: UserRecord): AuthenticatedAccount {
  return { email: user.email, name: user.fullName, role: user.role };
}

function currentAccount(user: UserRecord): CurrentAccount {
  return {
    userId: user.id,
    ...authenticatedAccount(user),
  };
}

function toUserDto(user: UserRecord): UserDto {
  return {
    id: user.id,
    code: user.code,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    role: user.role,
    emailVerified: user.emailVerified,
    active: user.active,
    version: user.version,
    addedAt: user.createdAt.toISOString(),
  };
}

export function normalizeUserEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isWorkspaceEmail(email: string) {
  return email.endsWith("@yu.edu.kz");
}

function externalIdentityName(value: string | null | undefined, email: string) {
  const name = value?.trim();
  if (name && name.length >= 2 && name.length <= 120) return name;
  const localPart = email.split("@", 1)[0]?.trim();
  const fallback = localPart && localPart.length >= 2 ? localPart : "YU user";
  return fallback.slice(0, 120);
}

function requireEmail(value: string): string {
  const email = normalizeUserEmail(value);
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new ApplicationError("validation", "invalid_email");
  }
  return email;
}

function requireName(value: string): string {
  const name = value.trim();
  if (name.length < 2 || name.length > 120) {
    throw new ApplicationError("validation", "invalid_user_name");
  }
  return name;
}

function normalizePhone(value: string | null | undefined): string | null {
  const phone = value?.trim();
  if (!phone || phone === "—") return null;
  if (phone.length > 32) {
    throw new ApplicationError("validation", "invalid_phone");
  }
  return phone;
}

function normalizeInitialPassword(value: string | undefined): string | null {
  if (value === undefined || value === "") return null;
  if (value.length < 12 || value.length > 128) {
    throw new ApplicationError("validation", "invalid_initial_password");
  }
  return value;
}

export function credentialForVerification(
  value: PasswordCredentialRecord | null,
): { salt: string; hash: Uint8Array } | null {
  return value ? { salt: value.salt, hash: value.hash } : null;
}

function equalBytes(first: Uint8Array, second: Uint8Array): boolean {
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) {
    difference |= first[index]! ^ second[index]!;
  }
  return difference === 0;
}

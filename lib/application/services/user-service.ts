import type {
  CreateUserInput,
  UpdateUserInput,
  UserDto,
  UserRole,
} from "@/lib/contracts/users";
import type { TmcOperationUserDto } from "@/lib/contracts/tmc-operations";
import {
  normalizeTmcRecipientQuery,
  TMC_RECIPIENT_QUERY_MAX_LENGTH,
  TMC_RECIPIENT_RESULT_LIMIT,
} from "@/lib/tmc-recipient-search";
import { ApplicationError } from "@/lib/domain/application-error";
import { isUuid } from "@/lib/domain/identifiers";
import type { UnitOfWork } from "@/lib/application/ports/unit-of-work";
import type {
  PasswordCredentialRecord,
  UserRecord,
  UserRepositories,
} from "@/lib/application/ports/user-repositories";
import type { PasswordHasher } from "@/lib/application/ports/password-hasher";
import type {
  YessenovDirectoryClient,
  YessenovDirectoryEmployee,
} from "@/lib/yessenov-directory";
import {
  canManageUser,
  hasPermission,
  type AuthorizationActor,
} from "@/lib/security/permissions";

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
  sessionVersion: number;
}

type AuthenticatedRecipientSearchActor = AuthorizationActor & {
  sessionVersion: number;
};

type AuthenticatedUserManagementActor = AuthorizationActor & {
  sessionVersion: number;
};

export type AuthenticationResult =
  | {
      status: "authenticated";
      user: AuthenticatedAccount;
      sessionVersion: number;
    }
  | { status: "blocked" }
  | { status: "invalid" };

export class UserService {
  constructor(
    private readonly unitOfWork: UnitOfWork<UserRepositories>,
    private readonly passwordHasher: PasswordHasher,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly personnelDirectory?: Pick<
      YessenovDirectoryClient,
      "listEmployees"
    >,
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
    if (
      account.credential &&
      this.passwordHasher.needsRehash?.(account.credential)
    ) {
      const upgraded = await this.passwordHasher.hash(password);
      await this.unitOfWork.transaction(({ credentials }) =>
        credentials.replace({
          userId: account.user!.id,
          ...upgraded,
          updatedAt: this.clock.now(),
        }),
      );
    }
    return {
      status: "authenticated",
      user: authenticatedAccount(account.user),
      sessionVersion: account.user.version,
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
            return { status: "invalid" };
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
          sessionVersion: user.version,
        };
      },
      { isolation: "read-committed" },
    );
  }

  async authenticateYessenovIdentity(input: {
    subject: string;
    email: string;
    name: string;
    iin?: string | null;
    phoneNumber?: string | null;
    tutorId?: string | null;
    orgUnit?: string | null;
    position?: string | null;
  }): Promise<AuthenticationResult> {
    let email: string;
    let fullName: string;
    try {
      email = requireEmail(input.email);
      fullName = requireName(input.name);
    } catch {
      return { status: "invalid" };
    }
    const subject = input.subject.trim();
    const claimedIin = normalizeYessenovIin(input.iin);
    const phone = normalizeYessenovPhone(input.phoneNumber);
    const tutorId = normalizeYessenovText(input.tutorId, 64);
    const orgUnit = normalizeYessenovText(input.orgUnit, 255);
    const position = normalizeYessenovText(input.position, 255);
    if (!isWorkspaceEmail(email) || !subject || subject.length > 255) {
      return { status: "invalid" };
    }

    return this.unitOfWork.transaction(
      async ({ users, externalIdentities }) => {
        await externalIdentities.lockProvisioning(
          "yessenov",
          subject,
          email,
          claimedIin,
        );
        let user = await externalIdentities.findUserBySubject(
          "yessenov",
          subject,
        );

        if (!user) {
          user = await users.findByNormalizedEmailForUpdate(email);
          if (!user) {
            const createdAt = this.clock.now();
            const iinOwner = claimedIin
              ? await users.findByIinForUpdate(claimedIin)
              : null;
            user = await users.insert({
              id: this.ids.create(),
              email,
              fullName,
              iin: iinOwner ? null : claimedIin,
              orgUnit,
              position,
              tutorId,
              role: "employee",
              phone,
              emailVerified: true,
              active: true,
              createdAt,
            });
          } else {
            if (user.deletedAt) return { status: "invalid" };
            if (!user.active) return { status: "blocked" };
          }

          const existingIdentity = await externalIdentities.findByUser(
            "yessenov",
            user.id,
          );
          if (existingIdentity && existingIdentity.subject !== subject) {
            return { status: "invalid" };
          }
          if (!existingIdentity) {
            try {
              await externalIdentities.insert({
                provider: "yessenov",
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
        let safeClaimedIin = user.iin ?? null;
        if (!safeClaimedIin && claimedIin) {
          const iinOwner = await users.findByIinForUpdate(claimedIin);
          if (!iinOwner || iinOwner.id === user.id) {
            safeClaimedIin = claimedIin;
          }
        }
        const nextProfile = {
          fullName,
          iin: safeClaimedIin,
          orgUnit: orgUnit ?? user.orgUnit ?? null,
          position: position ?? user.position ?? null,
          tutorId: tutorId ?? user.tutorId ?? null,
          phone: phone ?? user.phone,
        };
        if (
          user.fullName !== nextProfile.fullName ||
          (user.iin ?? null) !== nextProfile.iin ||
          (user.orgUnit ?? null) !== nextProfile.orgUnit ||
          (user.position ?? null) !== nextProfile.position ||
          (user.tutorId ?? null) !== nextProfile.tutorId ||
          user.phone !== nextProfile.phone ||
          !user.emailVerified
        ) {
          const synchronized = await users.update({
            id: user.id,
            ...nextProfile,
            role: user.role,
            emailVerified: true,
            active: user.active,
            expectedVersion: user.version,
            updatedAt: this.clock.now(),
          });
          if (!synchronized) {
            throw new ApplicationError("conflict", "user_version_conflict");
          }
          user = synchronized;
        }
        return {
          status: "authenticated",
          user: authenticatedAccount(user),
          sessionVersion: user.version,
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
      const user = await repositories.users.findByNormalizedEmailForUpdate(email);
      if (!user || !user.active || user.deletedAt) return false;
      const replaced = await repositories.credentials.replace({
        userId: user.id,
        ...passwordHash,
        updatedAt: this.clock.now(),
      });
      if (!replaced) return false;
      const updated = await repositories.users.update({
        id: user.id,
        fullName: user.fullName,
        role: user.role,
        phone: user.phone,
        emailVerified: user.emailVerified,
        active: user.active,
        expectedVersion: user.version,
        updatedAt: this.clock.now(),
      });
      return updated !== null;
    });
  }

  async revokeSessions(emailInput: string): Promise<boolean> {
    const email = normalizeUserEmail(emailInput);
    if (!email) return false;
    return this.unitOfWork.transaction(async ({ users }) => {
      const user = await users.findByNormalizedEmailForUpdate(email);
      if (!user || !user.active || user.deletedAt) return false;
      return (
        (await users.update({
          id: user.id,
          fullName: user.fullName,
          role: user.role,
          phone: user.phone,
          emailVerified: user.emailVerified,
          active: user.active,
          expectedVersion: user.version,
          updatedAt: this.clock.now(),
        })) !== null
      );
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
        .map((user) => toUserDto(user)),
    );
  }

  async listUsersForManagement(
    actor: AuthenticatedUserManagementActor,
  ): Promise<UserDto[]> {
    if (
      !isUuid(actor.userId) ||
      !Number.isSafeInteger(actor.sessionVersion) ||
      actor.sessionVersion < 1 ||
      !hasPermission(actor.role, "legacy.users.read")
    ) {
      throw new ApplicationError("forbidden", "forbidden");
    }

    const actorUserId = actor.userId.toLowerCase();
    if (this.personnelDirectory) {
      await this.unitOfWork.transaction(async ({ users }) => {
        const currentActor = await requireCurrentActor(
          users,
          actorUserId,
          actor.sessionVersion,
        );
        if (
          currentActor.role !== actor.role ||
          !hasPermission(currentActor.role, "legacy.users.read")
        ) {
          throw new ApplicationError("forbidden", "forbidden");
        }
      });
      const directoryEmployees =
        await this.personnelDirectory.listEmployees();
      return this.synchronizeDirectoryUsers(
        directoryEmployees,
        actor,
        actorUserId,
      );
    }
    return this.unitOfWork.transaction(async ({ users }) => {
      const currentActor = await requireCurrentActor(
        users,
        actorUserId,
        actor.sessionVersion,
      );
      if (
        currentActor.role !== actor.role ||
        !hasPermission(currentActor.role, "legacy.users.read")
      ) {
        throw new ApplicationError("forbidden", "forbidden");
      }
      return (await users.list())
        .filter((user) => !user.deletedAt)
        .map((user) => toUserDto(user, true));
    });
  }

  private async synchronizeDirectoryUsers(
    directoryEmployees: YessenovDirectoryEmployee[],
    actor: AuthenticatedUserManagementActor,
    actorUserId: string,
  ): Promise<UserDto[]> {
    return this.unitOfWork.transaction(async ({ users }) => {
      const currentActor = await requireCurrentActor(
        users,
        actorUserId,
        actor.sessionVersion,
      );
      if (
        currentActor.role !== actor.role ||
        !hasPermission(currentActor.role, "legacy.users.read")
      ) {
        throw new ApplicationError("forbidden", "forbidden");
      }

      await users.lockDirectorySynchronization();
      const profilesByUserId = new Map<string, YessenovDirectoryEmployee>();
      for (const employee of directoryEmployees) {
        const synchronized = await users.synchronizeDirectoryUser({
          id: this.ids.create(),
          email: employee.email,
          fullName: employee.fullName,
          iin: employee.iin,
          orgUnit: directoryOrgUnitName(employee),
          position: employee.position?.name ?? null,
          personnelId: String(employee.personnelId),
          phone: employee.phone || null,
          synchronizedAt: this.clock.now(),
        });
        if (synchronized) {
          profilesByUserId.set(synchronized.id, employee);
        }
      }

      return (await users.list())
        .filter((user) => !user.deletedAt)
        .map((user) =>
          toUserDto(user, true, profilesByUserId.get(user.id)),
        );
    });
  }

  async searchTmcRecipients(
    query: string,
    actor: AuthenticatedRecipientSearchActor,
  ): Promise<TmcOperationUserDto[]> {
    const normalizedQuery = normalizeTmcRecipientQuery(query);
    if (
      Array.from(normalizedQuery).length > TMC_RECIPIENT_QUERY_MAX_LENGTH
    ) {
      throw new ApplicationError("validation", "recipient_query_too_long");
    }
    if (
      !isUuid(actor.userId) ||
      !Number.isSafeInteger(actor.sessionVersion) ||
      actor.sessionVersion < 1 ||
      !hasPermission(actor.role, "inventory.tmc.transfer_request.create")
    ) {
      throw new ApplicationError("forbidden", "forbidden");
    }

    const actorUserId = actor.userId.toLowerCase();
    return this.unitOfWork.transaction(async ({ users }) => {
      const currentActor = await users.findByIdForUpdate(actorUserId);
      if (
        !currentActor ||
        currentActor.id.toLowerCase() !== actorUserId ||
        !currentActor.active ||
        currentActor.deletedAt ||
        currentActor.version !== actor.sessionVersion ||
        currentActor.role !== actor.role ||
        !hasPermission(
          currentActor.role,
          "inventory.tmc.transfer_request.create",
        )
      ) {
        throw new ApplicationError("forbidden", "forbidden");
      }
      if (Array.from(normalizedQuery).length < 2) return [];
      const candidates = await users.searchActiveRecipients(
        normalizedQuery,
        actorUserId,
        TMC_RECIPIENT_RESULT_LIMIT,
      );
      return candidates
        .slice(0, TMC_RECIPIENT_RESULT_LIMIT)
        .map(({ id, fullName, email, role }) => ({
          id,
          fullName,
          email,
          role,
        }));
    }, { isolation: "repeatable-read", readOnly: false });
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
    actorSessionVersion: number,
  ): Promise<UserDto> {
    const id = this.ids.create();
    const createdAt = this.clock.now();
    const email = requireEmail(input.email);
    const fullName = requireName(input.fullName);
    const iin = normalizeIin(input.iin);
    const phone = normalizePhone(input.phone);
    const defaultRoomId = normalizeDefaultRoomId(input.defaultRoomId);
    const initialPassword = normalizeInitialPassword(input.initialPassword);
    const passwordHash = initialPassword
      ? await this.passwordHasher.hash(initialPassword)
      : null;
    if (input.active === true && !passwordHash && !isWorkspaceEmail(email)) {
      throw new ApplicationError("conflict", "user_login_not_configured");
    }

    return this.unitOfWork.transaction(async ({ users, credentials }) => {
      const actor = await requireCurrentActor(
        users,
        actorUserId,
        actorSessionVersion,
      );
      if (!canManageUser(actor.role, { nextRole: input.role })) {
        throw new ApplicationError("forbidden", "forbidden");
      }
      if (defaultRoomId && !(await users.isActiveRoom(defaultRoomId))) {
        throw new ApplicationError("validation", "invalid_default_room");
      }
      if (await users.findByNormalizedEmail(email)) {
        throw new ApplicationError("conflict", "email_already_exists");
      }
      const user = await users.insert({
        id,
        email,
        fullName,
        iin,
        phone,
        defaultRoomId,
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
      return toUserDto(user, true);
    });
  }

  async updateUser(
    id: string,
    input: UpdateUserInput,
    actorUserId: string,
    actorSessionVersion: number,
  ): Promise<UserDto> {
    const fullName = requireName(input.fullName);
    const iin = normalizeIin(input.iin);
    const phone = normalizePhone(input.phone);
    const defaultRoomId =
      input.defaultRoomId === undefined
        ? undefined
        : normalizeDefaultRoomId(input.defaultRoomId);
    const initialPassword = normalizeInitialPassword(input.initialPassword);
    const passwordHash = initialPassword
      ? await this.passwordHasher.hash(initialPassword)
      : null;

    return this.unitOfWork.transaction(async (repositories) => {
      const { users } = repositories;
      const actor = await requireCurrentActor(
        users,
        actorUserId,
        actorSessionVersion,
      );
      const current = await users.findByIdForUpdate(id);
      if (!current || current.deletedAt) {
        throw new ApplicationError("not_found", "user_not_found");
      }
      const nextDefaultRoomId =
        defaultRoomId === undefined ? (current.defaultRoomId ?? null) : defaultRoomId;
      if (
        !canManageUser(actor.role, {
          currentRole: current.role,
          nextRole: input.role,
        })
      ) {
        throw new ApplicationError("forbidden", "forbidden");
      }
      if (nextDefaultRoomId && !(await users.isActiveRoom(nextDefaultRoomId))) {
        throw new ApplicationError("validation", "invalid_default_room");
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
        iin,
        phone,
        defaultRoomId: nextDefaultRoomId,
        role: input.role,
        emailVerified: input.emailVerified,
        active: input.active,
        expectedVersion: input.version,
        updatedAt: this.clock.now(),
      });
      if (!updated) {
        throw new ApplicationError("conflict", "user_version_conflict");
      }
      return toUserDto(updated, true);
    });
  }

  async deleteUser(
    id: string,
    version: number,
    actorUserId: string,
    actorSessionVersion: number,
  ): Promise<void> {
    await this.unitOfWork.transaction(async ({ users }) => {
      const actor = await requireCurrentActor(
        users,
        actorUserId,
        actorSessionVersion,
      );
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

async function requireCurrentActor(
  users: UserRepositories["users"],
  actorUserId: string,
  actorSessionVersion: number,
): Promise<UserRecord> {
  const actor = await users.findByIdForUpdate(actorUserId);
  if (
    !actor ||
    !actor.active ||
    actor.deletedAt ||
    !Number.isSafeInteger(actorSessionVersion) ||
    actorSessionVersion < 1 ||
    actor.version !== actorSessionVersion
  ) {
    throw new ApplicationError("forbidden", "forbidden");
  }
  return actor;
}

function authenticatedAccount(user: UserRecord): AuthenticatedAccount {
  return { email: user.email, name: user.fullName, role: user.role };
}

function currentAccount(user: UserRecord): CurrentAccount {
  return {
    userId: user.id,
    sessionVersion: user.version,
    ...authenticatedAccount(user),
  };
}

function toUserDto(
  user: UserRecord,
  revealIin = false,
  directoryEmployee?: YessenovDirectoryEmployee,
): UserDto {
  return {
    id: user.id,
    code: user.code,
    fullName: directoryEmployee?.fullName ?? user.fullName,
    iin: revealIin
      ? (directoryEmployee?.iin ?? user.iin ?? null)
      : maskIin(directoryEmployee?.iin ?? user.iin ?? null),
    orgUnit: directoryEmployee
      ? directoryOrgUnitName(directoryEmployee)
      : (user.orgUnit ?? null),
    position: directoryEmployee?.position?.name ?? user.position ?? null,
    tutorId: revealIin
      ? String(directoryEmployee?.personnelId ?? user.tutorId ?? "") || null
      : undefined,
    directoryRoles: directoryEmployee?.roles,
    directoryManaged: Boolean(directoryEmployee),
    email: directoryEmployee?.email ?? user.email,
    phone: directoryEmployee?.phone || user.phone,
    defaultRoomId: user.defaultRoomId ?? null,
    role: user.role,
    emailVerified: user.emailVerified,
    active: user.active,
    version: user.version,
    addedAt: user.createdAt.toISOString(),
  };
}

function directoryOrgUnitName(employee: YessenovDirectoryEmployee) {
  return employee.orgUnit?.nameRu ??
    employee.orgUnit?.nameKk ??
    employee.orgUnit?.nameEn ??
    null;
}

function normalizeIin(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value.trim() === "") return null;
  const iin = value.trim();
  if (!/^[0-9]{12}$/.test(iin)) {
    throw new ApplicationError("validation", "invalid_iin");
  }
  return iin;
}

function normalizeDefaultRoomId(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.trim() === "") return null;
  const id = value.trim().toLowerCase();
  if (!isUuid(id)) {
    throw new ApplicationError("validation", "invalid_default_room");
  }
  return id;
}

function normalizeYessenovIin(value: string | null | undefined): string | null {
  const iin = value?.trim() ?? "";
  return /^[0-9]{12}$/.test(iin) ? iin : null;
}

function normalizeYessenovPhone(
  value: string | null | undefined,
): string | null {
  const phone = normalizeYessenovText(value, 32);
  return phone && /^[+0-9()\- .]+$/u.test(phone) ? phone : null;
}

function normalizeYessenovText(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  const normalized = value?.trim().replace(/\s+/gu, " ") ?? "";
  return normalized && Array.from(normalized).length <= maxLength
    ? normalized
    : null;
}

function maskIin(iin: string | null): string | null {
  return iin ? `******${iin.slice(-6)}` : null;
}

export function normalizeUserEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isWorkspaceEmail(email: string) {
  return email.endsWith("@yu.edu.kz");
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

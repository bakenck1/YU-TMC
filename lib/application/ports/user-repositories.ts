import type { UserRole } from "@/lib/contracts/users";

export interface UserRecord {
  id: string;
  code: string;
  email: string;
  fullName: string;
  role: UserRole;
  phone: string | null;
  emailVerified: boolean;
  active: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deactivatedAt: Date | null;
  deletedAt: Date | null;
}

export interface PasswordCredentialRecord {
  userId: string;
  salt: string;
  hash: Uint8Array;
  updatedAt: Date;
}

export interface InsertUserRecord {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  phone: string | null;
  emailVerified: boolean;
  active: boolean;
  createdAt: Date;
}

export interface UpdateUserRecord {
  id: string;
  fullName: string;
  role: UserRole;
  phone: string | null;
  emailVerified: boolean;
  active: boolean;
  expectedVersion: number;
  updatedAt: Date;
}

export interface InsertPasswordCredential {
  userId: string;
  salt: string;
  hash: Uint8Array;
  updatedAt: Date;
}

export interface UserRepository {
  list(): Promise<UserRecord[]>;
  findById(id: string): Promise<UserRecord | null>;
  findByNormalizedEmail(email: string): Promise<UserRecord | null>;
  insert(input: InsertUserRecord): Promise<UserRecord>;
  update(input: UpdateUserRecord): Promise<UserRecord | null>;
  softDelete(
    id: string,
    expectedVersion: number,
    deletedAt: Date,
  ): Promise<UserRecord | null>;
  countActiveAdminsForUpdate(): Promise<number>;
}

export interface PasswordCredentialRepository {
  findByUserId(userId: string): Promise<PasswordCredentialRecord | null>;
  insert(input: InsertPasswordCredential): Promise<void>;
  replace(input: InsertPasswordCredential): Promise<boolean>;
}

export interface AuthBootstrapRepository {
  isComplete(): Promise<boolean>;
  lockAndRead(): Promise<{ complete: boolean }>;
  complete(firstAdminUserId: string, completedAt: Date): Promise<void>;
}

export interface UserRepositories {
  users: UserRepository;
  credentials: PasswordCredentialRepository;
  bootstrap: AuthBootstrapRepository;
}

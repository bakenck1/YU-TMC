export const USER_ROLES = [
  "admin",
  "owner",
  "warehouse",
  "employee",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export interface UserDto {
  id: string;
  code: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: UserRole;
  emailVerified: boolean;
  active: boolean;
  version: number;
  addedAt: string;
}

export interface CreateUserInput {
  fullName: string;
  email: string;
  phone?: string | null;
  role: UserRole;
  emailVerified?: boolean;
  active?: boolean;
  initialPassword?: string;
}

export interface UpdateUserInput {
  fullName: string;
  phone?: string | null;
  role: UserRole;
  emailVerified: boolean;
  active: boolean;
  version: number;
  initialPassword?: string;
}

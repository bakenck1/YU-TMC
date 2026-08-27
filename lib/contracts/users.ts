export const USER_ROLES = [
  "admin",
  "warehouse",
  "employee",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export interface UserDto {
  id: string;
  code: string;
  fullName: string;
  /** Full value is returned only by authenticated administrator-management APIs. */
  iin?: string | null;
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
  iin?: string | null;
  email: string;
  phone?: string | null;
  role: UserRole;
  emailVerified?: boolean;
  active?: boolean;
  initialPassword?: string;
}

export interface UpdateUserInput {
  fullName: string;
  iin?: string | null;
  phone?: string | null;
  role: UserRole;
  emailVerified: boolean;
  active: boolean;
  version: number;
  initialPassword?: string;
}

export interface PasswordHash {
  salt: string;
  hash: Uint8Array;
}

export interface PasswordHasher {
  hash(password: string): Promise<PasswordHash>;
  verify(
    password: string,
    credential: { salt: string; hash: Uint8Array } | null,
  ): Promise<boolean>;
  needsRehash?(credential: { salt: string; hash: Uint8Array }): boolean;
}

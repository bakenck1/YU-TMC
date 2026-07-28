export type TransactionIsolation =
  | "read-committed"
  | "repeatable-read"
  | "serializable";

export type TransactionMaxAttempts = 1 | 2 | 3;

export interface TransactionOptions {
  isolation?: TransactionIsolation;
  readOnly?: boolean;
  maxAttempts?: TransactionMaxAttempts;
}

export interface UnitOfWork<Repositories> {
  read<Result>(
    work: (repositories: Repositories) => Promise<Result>,
  ): Promise<Result>;

  transaction<Result>(
    work: (repositories: Repositories) => Promise<Result>,
    options?: TransactionOptions,
  ): Promise<Result>;
}

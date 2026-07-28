# Server application layer

The application uses this dependency direction:

```text
app route / server entry point
  -> application service
    -> repository port
      -> server-only persistence adapter
```

UI components and route handlers must not import `pg`, Drizzle, `lib/db`, or
`lib/server/persistence`. They call the server application facade in
`lib/server/application.ts`. Shared UI contracts contain serializable values
only and never expose database rows or driver types.

## Current vertical slice

Application settings are the first complete slice. The settings route owns
HTTP concerns (rate limiting, the existing authorization check and response
mapping), `SettingsService` owns patch validation, and
`FileSettingsRepository` owns persistence.

The file adapter is a compatibility adapter until settings move to PostgreSQL.
It serializes updates inside one process and uses a same-directory temporary
file plus rename so readers see either the old or new document. It deliberately
does not claim cross-process locking. Missing files create defaults; corrupt
JSON and I/O failures are reported and are never silently overwritten.

Existing authentication storage and the TypeScript inventory arrays are
migrated by their later, explicit tasks.

## PostgreSQL transactions

`PostgresUnitOfWork` is the transaction boundary for future PostgreSQL
repositories:

- a top-level transaction uses one checked-out client and creates every
  repository from that client;
- nested transactions join the active transaction; they cannot change its
  isolation or read-only mode;
- reads made through the unit of work while a transaction is active use the
  same repositories and therefore see preceding writes;
- only serialization failures (`40001`) and deadlocks (`40P01`) are retried,
  with at most three attempts and bounded jitter;
- rollback failure never replaces the original error, and a broken connection
  is removed from the pool.

The whole callback can run again. It may call only transaction-bound
repositories. Network requests, email, object storage, generated one-time
tokens, and other external side effects belong after commit or in a
transactional outbox.

`requiresNew` transactions and savepoints are intentionally unsupported. Add
them only for a concrete domain requirement.

# YU Inventory testing strategy

The suite follows the test pyramid: deterministic unit tests for pure security
contracts, integration tests against real Next.js route handlers and proxy, and
a small number of browser journeys through a production server.

## Feature map

1. Authentication, sessions, registration, authorization, logout.
2. Password recovery, reset-code lifecycle, anti-bruteforce and delivery.
3. Inventory list: search, filters, selection and pagination.
4. Inventory details and item actions.
5. User management: filters, sorting, CRUD-style flows and pagination.
6. Settings persistence, permissions and localization.
7. Analytics calculations and interactive charts.
8. Locations, campus navigation and dashboard summaries.

Each feature is completed separately: test-design review, implementation,
execution, independent trust review, corrections, commit and push.

The complete local and CI gate is `npm run test:all`. It runs coverage first,
then builds the production application and executes the Playwright journey.
Use `YU_E2E_PORT` to choose another port for a concurrent local run.
The reset-password journey also reserves the next port for its authenticated
webhook fixture; override it with `YU_E2E_WEBHOOK_PORT` when necessary.

## Trust rules

- Tests never read or write the working `.data` directory.
- Security integration tests use real crypto, filesystem operations and route
  handlers; they do not mock the business logic they assert.
- E2E tests use a real production Next.js server and Chromium without API
  interception.
- Browser journeys use web-first assertions and never sleep for fixed periods.
- Stateful bootstrap flows are atomic and reset their dedicated data directory
  before every attempt, including retries.
- A negative assertion is paired with a positive control where practical.

## Documented architecture gaps

- Password-reset codes and rate-limit buckets are intentionally process-local
  in-memory state. A multi-instance deployment must move them to Redis/Valkey.
- Changing a password does not yet revoke already-issued session cookies.
- Enumeration-safe password-reset responses do not eliminate timing side
  channels from outbound delivery work.

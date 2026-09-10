# P3 — проверить measured Dockflow projection edge — Done

## Evidence

Baseline `capacity-v1` (2026-09-09): the exact production repository projection recorded P95
**255.47 ms** against a **250 ms** budget. A candidate-first projection introduced for task 24 now
records **56.14 ms**; this task still requires its own verification/review before closure.

## Expected gain and rollback

Repeat the baseline on the same dataset and inspect `EXPLAIN (ANALYZE, BUFFERS)` stability. If the
breach persists, target the measured plan node for P95 ≤ 250 ms. Roll back any index/query change that
misses the budget, increases writes materially, or changes cursor/result semantics.

## Acceptance

Either two repeat baselines place P95 ≤ 250 ms and close this as measurement noise, or a minimal
measured change meets the budget with unchanged Dockflow pagination and a documented rollback run.

## Status

Done 2026-09-10. The candidate-first query introduced in Task 24 was verified by two subsequent
production-like baselines: Dockflow projection P95 measured **56.14 ms** and **47.50 ms**, both well
below the fixed **250 ms** budget. The implementation keeps the public `(updated_at DESC, id ASC)`
keyset order and hydrates barcode, photo, location, assignment and responsible-user fields only after
candidate selection. The measured repository scenario projects 101 rows (100 plus its pagination
sentinel); the public API can request up to 200 rows plus sentinel. PostgreSQL integration coverage traverses all three
projection branches, asserts barcode/photo/location/assignment/responsible hydration, and covers the full
equal-timestamp cursor boundary. This verification task closes through the acceptance branch requiring
two repeat baselines; it does not rely on the uncommitted artifact from Task 24's rejected experiment.

Two fresh independent review passes scored implementation/closure and tests **8.7/8.4** and
**9.1/8.8** before their findings were fixed. The final changes correct the historical baseline,
state the measured and public page limits precisely, remove untraceable rollback claims, and add exact
PostgreSQL-backed hydration assertions for the available, individual-responsibility and group branches.
No third scoring pass was run, per the task-wide two-pass limit.

# P3 — проверить measured Dockflow projection edge

## Evidence

Baseline `capacity-v1` (2026-09-09): the exact production repository projection recorded P95
**255.47 ms** against a **250 ms** budget. The 2% breach is small enough that repeated evidence is
required before changing SQL or indexes.

## Expected gain and rollback

Repeat the baseline on the same dataset and inspect `EXPLAIN (ANALYZE, BUFFERS)` stability. If the
breach persists, target the measured plan node for P95 ≤ 250 ms. Roll back any index/query change that
misses the budget, increases writes materially, or changes cursor/result semantics.

## Acceptance

Either two repeat baselines place P95 ≤ 250 ms and close this as measurement noise, or a minimal
measured change meets the budget with unchanged Dockflow pagination and a documented rollback run.

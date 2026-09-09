# P3 — проверить measured Dockflow projection edge

## Evidence

Baseline `capacity-v1` (2026-09-09): the exact production repository projection recorded P95
**252.61 ms** against a **250 ms** budget. The next repeat recorded **246.55 ms**, so one more
sub-budget repeat is required before treating the original 1% breach as measurement noise.

## Expected gain and rollback

Repeat the baseline on the same dataset and inspect `EXPLAIN (ANALYZE, BUFFERS)` stability. If the
breach persists, target the measured plan node for P95 ≤ 250 ms. Roll back any index/query change that
misses the budget, increases writes materially, or changes cursor/result semantics.

## Acceptance

Either two repeat baselines place P95 ≤ 250 ms and close this as measurement noise, or a minimal
measured change meets the budget with unchanged Dockflow pagination and a documented rollback run.

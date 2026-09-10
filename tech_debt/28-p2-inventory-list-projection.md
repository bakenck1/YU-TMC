# P2 — оптимизировать inventory/export list projection — Done

## Evidence

After bounded keyset collection was introduced, baseline `capacity-v1` measured both the first-page
and cursor-page SQL forms. The artifact committed in `b9a97e0` recorded inventory P95 **765.83 ms** against the
**750 ms** budget; each form recursively touched more than four million shared buffers because heavy
lateral projections ran before the page was reduced.

## Expected gain and rollback

Select the bounded page before expensive photo, audit and responsibility projection while preserving
the lossless `(updated_at, id)` cursor, authorization predicates and complete 25,000-row result. Expected
gain: combined P95 ≤ 750 ms and fewer buffer hits. Roll back if ordering, snapshot completeness, item
shape or employee scoping changes.

## Acceptance

A repeated production-like baseline records combined first/cursor-page P95 ≤ 750 ms for both inventory
and export-source collection; PostgreSQL tests cover microsecond cursor boundaries and assigned-user
scoping; no collection read exceeds 500 rows and the 25,001st sentinel still fails explicitly.

## Status

Done 2026-09-10. `itemSelect` now materializes an ordered, filtered candidate-ID page before running
audit, QR, photo and service-photo projections. Responsibility and room predicates remain inside the
candidate CTE, so employee scoping and decommissioned filters are applied before `LIMIT`; the same
statement snapshot hydrates the selected IDs afterward. On the production-like 25,000-row dataset,
inventory P95 fell from **765.83 ms** to **123.91 ms**, and export-source P95 measured **120.67 ms**.
Recursively summed buffer hits fell from 4,308,388/4,217,220 to 1,477,127/1,450,171 for the first and
cursor forms. The lossless collection still returns all **25,000** rows in **51** reads capped at 500,
and the existing 25,001st-row sentinel remains an explicit failure.

Two fresh independent review passes scored implementation/tests **9.7/8.5** and **9.7/8.8** before
their findings were fixed. The final coverage pins timing and recursive-buffer budgets and exercises
direct responsibility, room-primary responsibility, unrelated decommissioned data, both decommissioned
statuses, and an authorized row placed behind a 500-row unscoped page boundary in real PostgreSQL.
No third scoring pass was run, per the task-wide two-pass limit.

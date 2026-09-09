# P2 — оптимизировать inventory/export list projection

## Evidence

After bounded keyset collection was introduced, baseline `capacity-v1` measures both the first-page
and cursor-page SQL forms. The latest repeat records inventory P95 **939.57 ms** and export-source P95
**909.96 ms** against the **750 ms** budget; the shared production query fingerprint records more than
four million shared buffer hits per form because lateral projections run before the page is reduced.

## Expected gain and rollback

Select the bounded page before expensive photo, audit and responsibility projection while preserving
the lossless `(updated_at, id)` cursor, authorization predicates and complete 25,000-row result. Expected
gain: combined P95 ≤ 750 ms and fewer buffer hits. Roll back if ordering, snapshot completeness, item
shape or employee scoping changes.

## Acceptance

A repeated production-like baseline records combined first/cursor-page P95 ≤ 750 ms for both inventory
and export-source collection; PostgreSQL tests cover microsecond cursor boundaries and assigned-user
scoping; no collection read exceeds 500 rows and the 25,001st sentinel still fails explicitly.

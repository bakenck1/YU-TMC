# P1 — заменить inventory/export whole-collection ceiling — Done

## Evidence

Baseline `capacity-v1` contains 25,000 active items. The production inventory/export repository asks
for a 10,001st sentinel and intentionally throws above the **10,000-row** safety ceiling. The SQL plan
is fast enough, but the actual product operation fails, so latency alone cannot produce a GO verdict.

## Expected gain and rollback

Define a bounded pagination/export contract that supports at least 25,000 items without weakening
authorization or silently truncating exports. Expected gain: inventory browsing and complete export
succeed at baseline cardinality while each database read remains bounded. Roll back if cursor
stability, permission filtering, export completeness, or memory use regresses.

## Acceptance

Behavioral and PostgreSQL tests prove stable bounded reads across 25,000 items; the UI and export
contract expose continuation or asynchronous completion explicitly; repeated capacity evidence no
longer reports `inventory_list_capacity` or `export_source_capacity`.

## Status

Done 2026-09-09. Inventory collections run in a repeatable-read, read-only snapshot with a lossless
`timestamptz(6), id` keyset cursor, 500-row SQL batches, and a supported 25,000-row total ceiling plus
one sentinel row. Larger collections fail explicitly with `inventory_collection_requires_async_export`;
filtered exports never silently truncate or broaden their selection. The refreshed disposable PostgreSQL
baseline returned all 25,000 rows in 51 bounded reads and the real 25,000-row workbook stayed within its
3,000 ms latency SLO; memory remains tracked separately in task 25.

Independent review used the requested two-pass limit: 5.5/10 (tests 6/10), then 7/10 (tests 6.5/10).
All actionable findings from both passes were addressed after the scores: upstream-filter awareness,
lossless microsecond cursor, full 25,000-row workload evidence, explicit total ceiling/error, and a real
PostgreSQL microsecond-boundary regression test. No third scoring pass was run.

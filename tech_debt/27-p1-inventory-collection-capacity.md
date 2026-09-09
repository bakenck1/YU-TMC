# P1 — заменить inventory/export whole-collection ceiling

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

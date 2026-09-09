# P2 — ограничить measured export memory growth

## Evidence

Baseline `capacity-v1` (2026-09-09): the isolated 25,000-row production workbook workload reached
**1,123.84 MiB** peak RSS growth, exceeding the **256 MiB** budget. The measured workload remains
within its 3,000 ms latency SLO.

## Expected gain and rollback

Profile retained heap and ExcelJS workbook allocation, then reduce RSS growth to at most 256 MiB while
preserving workbook columns and values. Roll back streaming, batching, or library changes if workbook
compatibility, latency SLO (3,000 ms), or generated content regresses.

## Acceptance

A repeated production-like baseline records RSS growth ≤ 256 MiB for 25,000 rows, export P95 ≤
3,000 ms, and byte-level/workbook-level functional tests confirm the existing export contract.

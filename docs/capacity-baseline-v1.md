# Capacity baseline capacity-v1

Generated 2026-09-09T08:04:12.663Z. Synthetic data only; no production dump or PII was used. Full PostgreSQL plans are stored in the adjacent JSON report. This is a nightly/release baseline, not a PR timing gate.

## Environment

- Node: v24.19.0; PostgreSQL: 17.10; platform: win32-x64
- CPU: 12 × 11th Gen Intel(R) Core(TM) i5-11400H @ 2.70GHz
- PostgreSQL: max_connections=100, shared_buffers=128MB, effective_cache_size=4GB
- Next production build: 4TarQSOTIQdtj5wIQIdF3
- Statement timeout: 2000ms, enforced=true, observed=2006.77ms

## Dataset

| Collection | Rows |
| --- | ---: |
| users | 5,000 |
| oneCInbox | 40,000 |
| buildings | 25 |
| rooms | 250 |
| items | 25,000 |
| photos | 12,500 |
| legacyTransfers | 40,000 |
| tmcTransferRequests | 40,000 |
| tmcTransferRequestItems | 40,000 |
| assetLossCases | 5,000 |
| notificationEvents | 40,000 |
| auditEvents | 40,000 |
| webPushOutbox | 40,000 |

Targets: 16 concurrent scanners, pool 8, worker concurrency 4, batch 50, lease 300s. Fixed dataset epoch: 2026-09-09T12:00:00.000Z.

Repository collection outcome: inventory=FAILS above 10000 rows; export=FAILS above 10000 rows. Query latency below does not override this functional verdict.

## Read-only PostgreSQL baseline

Each scenario ran 2 warmups plus 7 measured samples in `BEGIN READ ONLY` with `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`. Multi-statement rows represent the complete production repository operation, including TMC history hydration.

| Scenario (statements) | SHA-256 fingerprint | P50 ms | P95 ms | SLO ms | Plan summary |
| --- | --- | ---: | ---: | ---: | --- |
| inventory_list (1) | `92c8a2dfffa1` | 335 | 336.69 | 750 | 1× Limit; hit/read 4308388/0 |
| export_source (1) | `92c8a2dfffa1` | 341.14 | 350.23 | 750 | 1× Limit; hit/read 4308388/0 |
| dockflow_projection (1) | `5739592c899c` | 242.49 | 255.47 | 250 | 1× Limit; hit/read 1179549/0 |
| tmc_history (103) | `b6a16e38c1df` | 143.31 | 151.28 | 250 | 1× Limit; hit/read 2070/0 + 101× Sort; hit/read 239/0 + 1× Limit; hit/read 9498/0 |
| tmc_notifications (2) | `eb5fb0d563ab` | 96.62 | 97.24 | 250 | 1× Limit; hit/read 14603/0 + 1× Aggregate; hit/read 907800/0 |
| asset_loss_list (1) | `25a4dea2bb7e` | 7.77 | 7.91 | 250 | 1× Limit; hit/read 3887/0 |
| worker_due_scan (1) | `89201235596c` | 0.02 | 0.03 | 250 | 1× Limit; hit/read 6/0 |

## XML and export workloads

| Scenario | Records | P50 ms | P95 ms | SLO ms |
| --- | ---: | ---: | ---: | ---: |
| xml_parse | 5000 | 124.24 | 140.29 | 1000 |
| export_workbook | 10000 | 750.49 | 765.35 | 3000 |

Pool saturation: 16 requests through 8 connections, P50 545.25ms, P95 964.27ms, total 964.43ms, max waiting 8, errors 0.

Worker probe: 4 one-cycle workers claimed 200 distinct events (duplicates 0); natural shutdown 23.56ms against 2000ms budget, verified production lease 300s

Process RSS: 129.5 MiB → 601.47 MiB; heap used: 40.32 MiB → 242.69 MiB. Production client and server route chunks are recorded in the JSON report from the Next build manifests; Storybook is not used as a proxy.

## Ranked bottlenecks

1. **inventory_list_capacity** — rows 25000, budget 10000. Follow-up: Replace the fail-closed whole-collection path with a bounded product contract; expected capacity is at least 25000 rows; rollback if authorization, export completeness, or memory regresses.
2. **export_source_capacity** — rows 25000, budget 10000. Follow-up: Replace the fail-closed whole-collection path with a bounded product contract; expected capacity is at least 25000 rows; rollback if authorization, export completeness, or memory regresses.
3. **pool_saturation** — p95Ms 964.27, budget 500. Follow-up: Profile pool waits at 16 scanners; expected gain is p95 <= 500ms; rollback pool sizing if database saturation rises.
4. **export_memory** — peakGrowthMiB 334.26, budget 256. Follow-up: Profile retained heap and workbook allocation; expected isolated export peak growth <= 256 MiB; rollback changes that alter workbook content or increase peak memory.
5. **dockflow_projection** — p95Ms 255.47, budget 250. Follow-up: Profile dockflow_projection independently; expected gain is p95 <= 250ms; rollback any query/index change that misses that budget.

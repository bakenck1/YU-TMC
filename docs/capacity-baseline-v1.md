# Capacity baseline capacity-v1

Generated 2026-09-09T09:04:34.918Z. Synthetic data only; no production dump or PII was used. Full PostgreSQL plans are stored in the adjacent JSON report. This is a nightly/release baseline, not a PR timing gate.

## Environment

- Node: v24.19.0; PostgreSQL: 17.10; platform: win32-x64
- CPU: 12 × 11th Gen Intel(R) Core(TM) i5-11400H @ 2.70GHz
- PostgreSQL: max_connections=100, shared_buffers=128MB, effective_cache_size=4GB
- Next production build: kC4iYZRvZD3rcKZG49WH6
- Statement timeout: 2000ms, enforced=true, observed=2014.42ms

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

Repository collection outcome: inventory=25000 rows completed in 7253.97ms across 51 reads with batches <= 500; export=25000 rows completed in 7253.97ms across 51 reads with batches <= 500. Query latency below does not override this functional verdict.

## Read-only PostgreSQL baseline

Each scenario ran 2 warmups plus 7 measured samples in `BEGIN READ ONLY` with `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`. Multi-statement rows represent the complete production repository operation, including TMC history hydration.

| Scenario (statements) | SHA-256 fingerprint | P50 ms | P95 ms | SLO ms | Plan summary |
| --- | --- | ---: | ---: | ---: | --- |
| inventory_list (2) | `5b82ef505885` | 624.79 | 629.85 | 750 | 1× Limit; hit/read 4308388/0 + 1× Limit; hit/read 4217220/0 |
| export_source (2) | `5b82ef505885` | 634.24 | 645.74 | 750 | 1× Limit; hit/read 4308388/0 + 1× Limit; hit/read 4217220/0 |
| dockflow_projection (1) | `5739592c899c` | 242.81 | 246.55 | 250 | 1× Limit; hit/read 1179549/0 |
| tmc_history (103) | `b6a16e38c1df` | 43.25 | 44.71 | 250 | 1× Limit; hit/read 2070/0 + 101× Sort; hit/read 239/0 + 1× Limit; hit/read 9498/0 |
| tmc_notifications (2) | `eb5fb0d563ab` | 93.88 | 98.16 | 250 | 1× Limit; hit/read 14603/0 + 1× Aggregate; hit/read 907800/0 |
| asset_loss_list (1) | `25a4dea2bb7e` | 7.47 | 7.65 | 250 | 1× Limit; hit/read 3887/0 |
| worker_due_scan (1) | `89201235596c` | 0.02 | 0.02 | 250 | 1× Limit; hit/read 6/0 |

## XML and export workloads

| Scenario | Records | P50 ms | P95 ms | SLO ms |
| --- | ---: | ---: | ---: | ---: |
| xml_parse | 5000 | 119.47 | 125.69 | 1000 |
| export_workbook | 25000 | 1854.87 | 1952.06 | 3000 |

Pool saturation: 16 requests through 8 connections, P50 619.09ms, P95 972.03ms, total 972.19ms, max waiting 8, errors 0.

Worker probe: 4 one-cycle workers claimed 200 distinct events (duplicates 0); natural shutdown 18.14ms against 2000ms budget, verified production lease 300s

Process RSS: 128 MiB → 953.59 MiB; heap used: 49.72 MiB → 91.14 MiB. Production client and server route chunks are recorded in the JSON report from the Next build manifests; Storybook is not used as a proxy.

## Ranked bottlenecks

1. **export_memory** — peakGrowthMiB 1173.43, budget 256. Follow-up: Profile retained heap and workbook allocation; expected isolated export peak growth <= 256 MiB; rollback changes that alter workbook content or increase peak memory.
2. **pool_saturation** — p95Ms 972.03, budget 500. Follow-up: Profile pool waits at 16 scanners; expected gain is p95 <= 500ms; rollback pool sizing if database saturation rises.

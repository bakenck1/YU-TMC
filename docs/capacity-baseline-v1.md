# Capacity baseline capacity-v1

Generated 2026-09-09T09:18:55.796Z. Synthetic data only; no production dump or PII was used. Full PostgreSQL plans are stored in the adjacent JSON report. This is a nightly/release baseline, not a PR timing gate.

## Environment

- Node: v24.19.0; PostgreSQL: 17.10; platform: win32-x64
- CPU: 12 × 11th Gen Intel(R) Core(TM) i5-11400H @ 2.70GHz
- PostgreSQL: max_connections=100, shared_buffers=128MB, effective_cache_size=4GB
- Next production build: 5rdXDE5Gi061bFLr_AYNf
- Statement timeout: 2000ms, enforced=true, observed=2011.67ms

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

Repository collection outcome: inventory=25000 rows completed in 8352.81ms across 51 reads with batches <= 500; export=25000 rows completed in 8352.81ms across 51 reads with batches <= 500. Query latency below does not override this functional verdict.

## Read-only PostgreSQL baseline

Each scenario ran 2 warmups plus 7 measured samples in `BEGIN READ ONLY` with `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`. Multi-statement rows represent the complete production repository operation, including TMC history hydration.

| Scenario (statements) | SHA-256 fingerprint | P50 ms | P95 ms | SLO ms | Plan summary |
| --- | --- | ---: | ---: | ---: | --- |
| inventory_list (2) | `5b82ef505885` | 700.85 | 765.83 | 750 | 1× Limit; hit/read 4308388/0 + 1× Limit; hit/read 4217220/0 |
| export_source (2) | `5b82ef505885` | 671.61 | 729.07 | 750 | 1× Limit; hit/read 4308388/0 + 1× Limit; hit/read 4217220/0 |
| dockflow_projection (1) | `b2e44705cd0b` | 48.78 | 56.14 | 250 | 1× Sort; hit/read 53239/0 |
| tmc_history (103) | `b6a16e38c1df` | 46.63 | 154.05 | 250 | 1× Limit; hit/read 2070/0 + 101× Sort; hit/read 239/0 + 1× Limit; hit/read 9498/0 |
| tmc_notifications (2) | `eb5fb0d563ab` | 97.42 | 100.64 | 250 | 1× Limit; hit/read 14603/0 + 1× Aggregate; hit/read 907800/0 |
| asset_loss_list (1) | `25a4dea2bb7e` | 7.61 | 7.69 | 250 | 1× Limit; hit/read 3887/0 |
| worker_due_scan (1) | `89201235596c` | 0.02 | 0.03 | 250 | 1× Limit; hit/read 6/0 |

## XML and export workloads

| Scenario | Records | P50 ms | P95 ms | SLO ms |
| --- | ---: | ---: | ---: | ---: |
| xml_parse | 5000 | 120.08 | 124.74 | 1000 |
| export_workbook | 25000 | 2232.26 | 2479.04 | 3000 |

Pool saturation: 16 requests through 8 connections, P50 186.02ms, P95 252.83ms, total 253ms, max waiting 8, errors 0.

Worker probe: 4 one-cycle workers claimed 200 distinct events (duplicates 0); natural shutdown 22.94ms against 2000ms budget, verified production lease 300s

Process RSS: 128.3 MiB → 1096.87 MiB; heap used: 39.88 MiB → 73.37 MiB. Production client and server route chunks are recorded in the JSON report from the Next build manifests; Storybook is not used as a proxy.

## Ranked bottlenecks

1. **export_memory** — peakGrowthMiB 1123.84, budget 256. Follow-up: Profile retained heap and workbook allocation; expected isolated export peak growth <= 256 MiB; rollback changes that alter workbook content or increase peak memory.
2. **inventory_list** — p95Ms 765.83, budget 750. Follow-up: Profile inventory_list independently; expected gain is p95 <= 750ms; rollback any query/index change that misses that budget.

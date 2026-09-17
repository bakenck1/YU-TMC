# Capacity baseline capacity-v1

Generated 2026-09-17T09:57:22.892Z. Synthetic data only; no production dump or PII was used. Full PostgreSQL plans are stored in the adjacent JSON report. This is a nightly/release baseline, not a PR timing gate.

## Environment

- Node: v24.19.0; PostgreSQL: 17.10; platform: win32-x64
- CPU: 12 × 11th Gen Intel(R) Core(TM) i5-11400H @ 2.70GHz
- PostgreSQL: max_connections=100, shared_buffers=128MB, effective_cache_size=4GB
- Next production build: LaPcp1Vng4MkSwRtEacsK
- Statement timeout: 2000ms, enforced=true, observed=2012.67ms

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

Targets: 16 concurrent scanners, pool 8, worker concurrency 4, batch 50, lease 300s.

## Read-only PostgreSQL baseline

Each scenario ran 2 warmups plus 7 measured samples in `BEGIN READ ONLY` with `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`. Multi-statement rows represent the complete production repository operation.

| Scenario (statements) | SHA-256 fingerprint | P50 ms | P95 ms | SLO ms | Plan summary |
| --- | --- | ---: | ---: | ---: | --- |
| inventory_list (2) | `956878f2bf4a` | 128.12 | 129.36 | 750 | 1× Sort; hit/read 1568320/0 + 1× Sort; hit/read 1539864/0 |
| export_source (2) | `956878f2bf4a` | 128.15 | 129.94 | 750 | 1× Sort; hit/read 1568320/0 + 1× Sort; hit/read 1539864/0 |
| dockflow_projection (1) | `54d47fc34b29` | 49.8 | 53.7 | 250 | 1× Sort; hit/read 54319/0 |
| tmc_history (103) | `7377d4faa325` | 119.32 | 187.84 | 250 | 1× Limit; hit/read 2070/0 + 101× Sort; hit/read 239/0 + 1× Limit; hit/read 9498/0 |
| tmc_notifications (2) | `eb5fb0d563ab` | 102.43 | 105.01 | 250 | 1× Limit; hit/read 14603/0 + 1× Aggregate; hit/read 907800/0 |
| asset_loss_list (1) | `2ca47a58b033` | 10.81 | 11.41 | 250 | 1× Limit; hit/read 4007/0 |
| worker_due_scan (1) | `89201235596c` | 0.02 | 0.03 | 250 | 1× Limit; hit/read 6/0 |

## XML and export workloads

| Scenario | Records | P50 ms | P95 ms | SLO ms |
| --- | ---: | ---: | ---: | ---: |
| xml_parse | 5000 | 130.76 | 253.35 | 1000 |
| export_workbook | 25000 | 1598.87 | 1664.48 | 3000 |

Pool saturation: 16 requests through 8 connections, P50 241.5ms, P95 329.17ms, total 329.31ms, max waiting 8, errors 0.

Worker probe: 4 one-cycle workers claimed 200 distinct events (duplicates 0); natural shutdown 31.68ms against 2000ms budget, verified production lease 300s

Process RSS: 81.27 MiB → 162.97 MiB; heap used: 35.58 MiB → 82.44 MiB. Production client and server route chunks are recorded in the JSON report from the Next build manifests; Storybook is not used as a proxy.

## Ranked bottlenecks

No measured query, timeout, or worker-shutdown bottleneck exceeded its declared budget. No speculative optimization task was created.

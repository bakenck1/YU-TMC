# P2 — устранить measured pool saturation — Done

## Evidence

Baseline `capacity-v1` (2026-09-09): 16 simultaneous Dockflow scanners through an 8-connection
pool produced P95 **972.03 ms** against the **500 ms** budget, with 8 requests waiting.

## Expected gain and rollback

Profile database time versus pool wait, then make the smallest measured query or deployment-sizing
change that brings repeated P95 to at most 500 ms without increasing PostgreSQL saturation. Roll back
the change if P95 misses the budget or database CPU/connections/error rate regress. Do not merely
increase the pool before measuring database headroom.

## Acceptance

A repeated production-like baseline records P95 ≤ 500 ms at 16 scanners, zero errors, and no database
saturation regression; the evidence identifies the changed mechanism and includes rollback results.

## Status

Done 2026-09-09. The pool remains at 8 connections. Candidate selection now runs before the expensive
Dockflow barcode/photo/location projection, reducing query P95 from 246.55 ms to **56.14 ms** and
recursively summed shared buffer hits from 1,179,549 to **53,239**. With the same 16 scanners, pool P95 fell from 972.03 ms
to **252.83 ms**, with zero errors and the statement timeout still enforced. The harness's `saturated`
flag means only that a request waited for one of the deliberately bounded eight connections; it is not
a PostgreSQL CPU-utilization measurement. For this repeatable synthetic baseline, the accepted database-pressure
proxy is unchanged connection count plus query latency, recursively summed buffer hits, statement-timeout enforcement,
and error count. Direct host CPU telemetry remains a production-observability concern, not evidence produced by this
portable benchmark. A branch-local top-N experiment was rolled back after it regressed
P95 to 1,185.05 ms and 2.63 million buffer hits.

Independent review used two fresh passes. Pass 1 scored implementation 8.8/10 and tests 7.0/10; pass 2
scored implementation 9.0/10 and tests 8.0/10. All concrete findings were addressed: load-shape assertions,
available-branch projection, full equal-timestamp keyset traversal, metric wording, and the documented saturation proxy.

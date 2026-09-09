# P2 — устранить measured pool saturation

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

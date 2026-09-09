# Capacity baseline

Task 20 uses the versioned, deterministic `capacity-v1` synthetic dataset. It contains no copied
production records or PII. The cardinality and workload contract lives in
`scripts/capacity/dataset-v1.json`; changing it creates a new dataset version instead of silently
moving the baseline.

Run `npm run capacity:baseline:local` on Windows x64 to build the production Next application,
create a disposable PostgreSQL 17 cluster under the operating-system temporary directory, migrate
and seed it, measure it, and remove it. The seed command refuses non-loopback hosts and requires the
runner's one-time `capacity-local-*` deployment identity plus `CAPACITY_ALLOW_DISPOSABLE_SEED=1`.

For a pre-seeded staging copy, set `CAPACITY_DATABASE_URL` and run `npm run capacity:baseline`.
The measurement process forces PostgreSQL `default_transaction_read_only=on`; it cannot seed or
mutate the database. Its optional worker probe additionally requires a loopback URL and a
`capacity-local-*` identity and is set only by the disposable runner. Use a least-privileged account
and never put a connection URL into an artifact.

The generated `docs/capacity-baseline-v1.json` retains full PostgreSQL
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` plans and SHA-256 query fingerprints. The companion Markdown
file contains the compact environment, P50/P95, SLO, pool saturation, statement-timeout,
worker-concurrency/shutdown, process-memory, production Next route-chunk, and ranked-bottleneck
summary. These measurements are nightly/release evidence and deliberately are not a PR timing gate.
Storybook output is never used as a proxy for production route size.

The worker probe claims outbox work and is therefore enabled only by the disposable local runner.
Any ranked breach becomes a separate change with its measured metric, expected gain, and rollback;
this baseline introduces no index, cache, pagination, streaming, or queue optimization.

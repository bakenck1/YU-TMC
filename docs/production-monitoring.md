# Production monitoring automation

Goal: keep a lightweight Codex automation running every 30 minutes that only looks for production errors, not routine logs.

Model:

- `GPT 5.4 Mini`
- medium effort

Source of truth for each run:

- fetch only the last 30 minutes of production logs;
- discard non-error noise immediately;
- preserve stack traces, request IDs, routes, status codes, and any relevant timestamps;
- write one markdown file per error signature in `errors/`.

## Structured application events

Server HTTP boundaries and the TMC push worker write one JSON object per event to
stdout/stderr. The stable envelope is `timestamp`, `level`, `event`, `requestId`,
`route`, `status`, `duration` (milliseconds), `deploymentId` and `errorCode`.
Only allowlisted scalar aggregate attributes are admitted. Cookie and
authorization headers, request/XML bodies, email, IIN, full name, photo bytes or
data URLs, and nested `cause`/`details` are discarded rather than serialized.

Set the non-secret `APP_DEPLOYMENT_ID` to the release identifier. Incoming
`X-Request-Id` is ignored unless `TRUST_FORWARDED_REQUEST_ID=true`. Enable that
flag only when the approved ingress removes any client-supplied value and writes
its own validated identifier. Safe error responses return the resulting server
ID in `X-Request-Id`; unexpected exceptions also return it in the JSON body.

The first instrumented surfaces are Dockflow and 1C, login/auth compatibility,
asset-loss, unexpected HTTP failures and the durable TMC push worker. Expected
4xx responses are recorded at `info`, not promoted to error incidents. A 5xx or
worker failure is correlated to deployment/request without serializing the
exception or user data.

Recommended execution command inside Codex:

```bash
npm run monitor:prod-errors
```

If the production log source is external, set one of these before the command:

- `PROD_LOG_SOURCE_COMMAND`
- `PROD_LOG_SOURCE_FILE`

The monitor script accepts:

- `--since-minutes 30`
- `--source-command "<command>"`
- `--source-file "<path>"`
- `--output-dir errors`

Operational behavior:

- duplicate error signatures are merged into the same markdown file;
- `errors/.monitor-state.json` keeps the de-duplication state local to the workspace;
- if no error is found, the run exits cleanly without adding new files;
- the monitor does not try to diagnose root cause;
- resolving and deleting the report stays a separate daily cleanup workflow.

The parser accepts both the JSON envelope and older journal text lines. Its JSON
path is allowlist-based; the legacy text path applies defensive redaction before
writing a report.

## Legacy evidence report

The same journal contains aggregate `legacy.usage` events for all six entries in
[`legacy-compatibility.md`](./legacy-compatibility.md). Generate a reproducible
quarterly report from the retained log export:

```bash
npm run legacy:report -- --source-file <journal.ndjson> --output-file <report.md> --from <ISO timestamp> --to <ISO timestamp> --coverage-confirmed --uptime-confirmed
```

Both confirmation flags must be supplied by the monitoring owner. Without a
complete 90-day interval, confirmed collection coverage and confirmed observer
uptime, absence of events remains `unknown`. The report can only mark an entry
eligible for owner review; it never removes code or makes a sunset decision.

Suggested task prompt for Codex:

> Every 30 minutes, inspect only the last 30 minutes of production logs. Filter out normal logs immediately and keep only error-level events, 5xx responses, uncaught exceptions, and stack traces. If you find an error, save one markdown report per unique signature in `errors/<error_name>.md` with the trace, context, timestamps, route, request ID, and status code. Do not investigate the root cause. Use GPT 5.4 Mini with medium effort.

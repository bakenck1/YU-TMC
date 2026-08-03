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

Suggested task prompt for Codex:

> Every 30 minutes, inspect only the last 30 minutes of production logs. Filter out normal logs immediately and keep only error-level events, 5xx responses, uncaught exceptions, and stack traces. If you find an error, save one markdown report per unique signature in `errors/<error_name>.md` with the trace, context, timestamps, route, request ID, and status code. Do not investigate the root cause. Use GPT 5.4 Mini with medium effort.


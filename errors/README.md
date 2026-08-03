# Production error reports

This directory stores markdown incident notes created by the production log monitor.

Each file should describe one distinct error signature and include:

- the error trace;
- the observed time window;
- route, request ID, status code, and other useful context when available;
- a short sample of the surrounding log context.

The monitor keeps a hidden state file at `errors/.monitor-state.json` so repeated runs update the same incident instead of creating duplicates.


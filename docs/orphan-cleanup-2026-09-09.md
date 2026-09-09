# Orphan cleanup evidence — 2026-09-09

Decision owner: repository operator `bakenck1`.

Approval record: the operator explicitly requested completion, commit and push of every
entry in `tech_debt/00-index.md` in the Codex backlog-close session on 2026-09-09.
This record covers only removal of `lib/items-21-110.ts`; it is not approval to sunset
any registered legacy compatibility boundary.

## Reproducible evidence

- `git grep -n -E 'items21to110|items-21-110|items/records/item-'` returned no
  consumer outside the debt/evidence guard after deletion.
- Repository inspection covered `package.json`, application source, scripts, tests,
  runbooks under `docs/`, and public asset references; none invoked or loaded the file.
- `git log --follow -- lib/items-21-110.ts` identifies it as an old standalone demo
  dataset. The current seed entry point remains `scripts/db/seed.ts -> lib/data.ts`.
- `npm run build`, `npm run test:all`, `npm run legacy:check`, focused compatibility
  tests and lint pass after deletion.

The deletion is atomic and recoverable with `git revert` of its cleanup commit. Physical
QR labels, seed fixtures, migrations, `lib/data.ts`, `FileSettingsRepository`, and both
transfer domains are unchanged.

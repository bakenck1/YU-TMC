# Repository artifact policy

## Decision

Status: active.

Owner: repository maintainer.

Created: 2026-08-14. Next review: 2026-11-12. The review interval is 90 days.

The repository keeps `_audit/` as tracked immutable evidence until an external
archive satisfies the migration criteria below. This is a provenance and
maintenance decision, not a runtime-data decision: Docker build context and
the production runtime must not receive audit reports, tests, documentation,
or local generated artifacts.

Historical reports are never rewritten to make them look current. A correction
or a new audit creates a new dated report. The current catalog, report commit
SHAs, and generated-history rules are maintained in
[`scripts/repository-artifacts-baseline.json`](../scripts/repository-artifacts-baseline.json)
and checked by `npm run artifacts:check`.

## Immutable evidence catalog

| Artifact | Date | Scope | Provenance | Retention |
| --- | --- | --- | --- | --- |
| `_audit/Anthropic-Cybersecurity-Skills` | source pinned at review time | OWASP/API security checklist and evidence source | gitlink `e612f4944c55d306bb75565022442d7da8cf2b9a`; locator in `.gitmodules` | indefinite until security/legal review |
| `docs/security-audit-2026-08-03.md` | 2026-08-03 | security, authorization, dependency and release-readiness review | commit `b28f9a1336da078063e792ffddcab85ec430ff8e` | indefinite until security/legal review |
| `docs/security-audit-2026-08-10.md` | 2026-08-10 | production-readiness security review and remediation evidence | commit `0e819ebd3bf00bc3603e23062977d0808a69d6c1` | indefinite until security/legal review |
| `docs/security-audit-2026-08-14.md` | 2026-08-14 | API authorization, persistence boundaries, build and runtime-image hardening | commit `b81d8dc306f36c6d4983082b8319c93785c9e513` | indefinite until security/legal review |
| `docs/ui-refactor-report.md` | 2026-08-12 | UI architecture, component boundaries and Storybook enforcement | commit `2ae72709ee298b2e51f6aece69242cc8bc3e9ad8` | retain as engineering history |

The catalog is deliberately separate from the historical reports. A reviewer
can identify the exact source revision without changing the report's original
scope, wording, test counts, or limitations.

## Generated migration history

The committed migration history is append-only. The source migration is the
SQL file recorded by `drizzle/meta/_journal.json`; Drizzle's generated
snapshot uses the migration's 14-digit timestamp, so a journal tag such as
`20260814105617_settings-persistence` maps to the SQL tag and
`20260814105617_snapshot.json`.

Rules:

- every journal index is contiguous and every tag is unique;
- every journal tag has exactly one committed SQL file;
- every schema-changing journal timestamp has exactly one committed snapshot;
- historical SQL, journal entries, and snapshots are not edited manually;
- schema changes add a new migration and run `npm run db:check` before merge.

`drizzle/meta/_journal.json` remains the ordering/provenance record. The
artifact checker verifies the file set and mapping; Drizzle's own check remains
the semantic schema/snapshot validation. The raw-SQL-only
`20260808120000_security_resource_quotas` migration is the explicit exception:
it changes database routines, indexes and quotas without changing the Drizzle
schema model, so it has no generated snapshot and is still required to have a
journal entry and committed SQL.

## Ephemeral local and build artifacts

Generated contents of the following paths are not repository evidence and must
remain untracked and out of Docker build context: `errors/`, `errors-test/`,
`storybook-static/`, `.next/`, `drizzle-probe/`, and TypeScript
`*.tsbuildinfo`. The tracked `errors/.gitkeep` and `errors/README.md` are only
an empty operational scaffold; generated error reports may contain sensitive
context. Build/probe output is reproducible and has no retention requirement.

The `.gitignore` and `.dockerignore` entries for these paths are part of the
policy. If a generated artifact needs long-term retention, copy a sanitized,
dated report into the evidence catalog instead of committing the raw output.

## New audit report contract

Every new dated audit report must include, in the report itself and in the
catalog change:

- the report date;
- an explicit scope and exclusions/limitations;
- the full 40-character commit SHA under provenance;
- the validation commands and their result;
- the owner and the evidence/artifact locations used.

Minimal template:

```text
# Audit report, YYYY-MM-DD

## Scope
...

## Provenance
- Date: YYYY-MM-DD
- Commit SHA: <40-character SHA>
- Owner: repository maintainer

## Validation
- `npm run ...`: passed / failed / skipped with reason

## Limitations
...
```

Existing reports are cataloged without retroactive edits. New reports must be
append-only and must be added to the machine-readable baseline in the same
change set.

## External archive decision

Moving full evidence out of Git is a separate decision. It is allowed only
when all of these are true:

1. clone/review cost is measured and materially affects maintainers;
2. reviewers and deployers have reliable read access;
3. legal/security retention is approved;
4. backup and restore are verified from an immutable copy;
5. the repository retains a hash/index, dates, scopes and provenance links;
6. the restore check passes before the tracked copy is removed.

Until then, deleting `_audit/` or rewriting historical reports is not an
acceptable cleanup. The next policy review is 2026-11-12.

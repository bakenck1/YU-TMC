# Legacy usage evidence report

- Period: 2026-08-14T00:00:00.000Z — 2026-09-08T00:00:00.000Z
- Required window: 90 days
- Full window: no
- Collection coverage confirmed: no
- Observation uptime confirmed: no
- Evidence status: unknown

Instrumentation and the reproducible report command are available from
2026-09-08, but no production journal export is attached to this repository.
Therefore the table intentionally does not claim zero usage. The next scheduled
review is 2026-11-12, after a complete retained interval can exist.

| Compatibility ID | Owner | Observed events | Evidence | Decision |
| --- | --- | ---: | --- | --- |
| LEGACY-PERMISSIONS | Security/Auth maintainer | n/a | unknown | keep |
| LEGACY-TRANSFER-ROUTES | Inventory responsibility maintainer | n/a | unknown | keep |
| LEGACY-QR-ALIASES | Inventory/QR maintainer | n/a | unknown | keep |
| LEGACY-AUTH-IMPORT | Auth/DB migration maintainer | n/a | unknown | keep |
| LEGACY-COOKIE-CONTRACT | Auth maintainer | n/a | unknown | keep |
| LEGACY-SEED-DATA | Data migration maintainer | n/a | unknown | keep |

Run `npm run legacy:report` with the retained production journal, exact ISO
window and both owner-confirmed coverage flags. Any keep/deprecate/remove verdict
remains a separate owner decision; this report never deletes compatibility code.

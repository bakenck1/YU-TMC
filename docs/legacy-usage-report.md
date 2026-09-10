# Legacy usage evidence report

- Production observation period: not established (no production export attached)
- Required window: 90 days
- Full window: no
- Collection coverage confirmed: no
- Observation uptime confirmed: no
- Evidence status: unknown

Instrumentation and the reproducible report command exist in repository history
from 2026-09-08, but no production deployment timestamp or journal export is
attached. Therefore the table intentionally does not claim zero usage. The
scheduled policy review on 2026-11-12 does not complete the evidence gate: the
90-day interval starts only at a verified production deployment with owner-confirmed
coverage and uptime.

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

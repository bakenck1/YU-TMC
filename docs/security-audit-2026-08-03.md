# Security audit, 2026-08-03

## Scope and method

The review covered the Next.js frontend, every App Router API route, application
services, PostgreSQL repositories and migrations, authentication, Google SSO,
password reset, uploads, Excel processing, push subscriptions, browser policy,
secrets, and the npm dependency graph. The OWASP API workflow from
`_audit/Anthropic-Cybersecurity-Skills` commit
`e612f4944c55d306bb75565022442d7da8cf2b9a` was used as a checklist, especially
BOLA/IDOR, BFLA, mass assignment, injection, excessive data exposure, and rate
limiting.

This is a source and local-build audit. It does not replace a production
penetration test with separate employee, warehouse, and administrator accounts,
real ingress headers, multiple application instances, and production telemetry.

## Findings

Scores use a 1-10 risk scale, where 10 is the highest risk.

| ID | Score | Finding | Status |
| --- | ---: | --- | --- |
| SEC-01 | 8/10 | Six vulnerable production dependencies (`next` transitive `postcss`/`sharp`, `exceljs` transitive `uuid`, and `brace-expansion`) allowed XSS/file disclosure, image-parser compromise/DoS, memory exhaustion, or unsafe UUID buffer use in affected call paths. | Fixed with scoped overrides; production and full npm audits now report zero advisories. |
| SEC-02 | 7/10 | Most authenticated application endpoints had no common throttling, so UUID/QR probing and expensive list/export operations could be automated without the limiter used by auth routes. | Locally fixed by enforcing the API limiter in `requireCurrentUser`. Distributed enforcement remains SEC-07. |
| SEC-03 | 6/10 | Transfer decision/cancel returned `404` for an absent transfer but `403` for an existing transfer belonging to another employee, creating an object-existence oracle. | Fixed: unauthorized object-bound requests now return the same `transfer_not_found` result. |
| SEC-04 | 6/10 | Cookie-authenticated mutations relied mainly on `SameSite` cookies. A same-site hostile origin or future cookie-policy regression could submit state-changing API requests. | Fixed: unsafe authenticated methods now reject cross-site Fetch Metadata and mismatched `Origin`. |
| SEC-05 | 5/10 | Several dynamic routes accepted any 36-character combination of hex digits and hyphens rather than a canonical UUID. This expanded the input space and made route behavior inconsistent. | Fixed with one canonical UUID validator and regression tests. |
| SEC-06 | 5/10 | Browser responses lacked a consistent clickjacking, MIME-sniffing, referrer, feature, HSTS, and CSP baseline. | Fixed with global headers. CSP intentionally starts with `base-uri`, `frame-ancestors`, and `object-src` to avoid breaking Next/2GIS; see SEC-10. |
| SEC-07 | 7/10 | Rate limits and password-reset codes are process-local. Multiple replicas, restarts, or serverless cold starts reset/bypass counters and can invalidate delivered codes. | Open architecture item. |
| SEC-08 | 7/10 | Password changes do not revoke already issued signed sessions. A stolen remembered cookie can remain usable for up to 30 days after password reset, although role/active status is refreshed on each request. | Open architecture item. |
| SEC-09 | 6/10 | Client IP selection trusts `cf-connecting-ip`, `x-real-ip`, and `x-forwarded-for`. If production ingress does not strip and overwrite these headers, attackers can rotate spoofed values to bypass per-IP limits. | Open deployment item. |
| SEC-10 | 5/10 | The CSP does not yet restrict `script-src`, `style-src`, `connect-src`, or `img-src`. A strict nonce/hash CSP requires an inventory of Next.js and 2GIS resources and browser regression testing. | Partially mitigated; open hardening item. |
| SEC-11 | 6/10 | Registry, audit, comments, and export endpoints return bounded-by-permission but potentially large datasets without cursor pagination. Authenticated scraping and memory/CPU exhaustion remain possible. | Open scalability/abuse item. |
| SEC-12 | 5/10 | JSON photo and multipart attachment bodies are parsed before decoded/file-size validation. Oversized or chunked bodies can consume memory before the application rejects them. | Open request-gateway item. |
| SEC-13 | 4/10 | Item comments expose author email addresses to every role with comment-read access. This is broader than necessary for most UI use and increases internal PII exposure. | Open product/privacy decision. |
| SEC-14 | 2/10 | `GET /api/settings` is public. It only exposes organization name, language, and notification feature flags, not secrets; the behavior appears required by the public auth UI. | Accepted low risk; document as public contract. |

## ID and BOLA review

No unauthenticated endpoint accepts a database object ID. Database identifiers are
generated with `randomUUID()` and are now validated as canonical UUIDs. UUIDs make
blind numeric enumeration impractical, but authorization remains mandatory and is
enforced in application services rather than trusted to page visibility.

| Endpoint group | ID fields | Authorization result |
| --- | --- | --- |
| `/api/users/[id]` | `id` | Administrator permission is required before update/delete; user-management policy also protects privileged-role changes. |
| `/api/inventory/buildings/[id]` | `id` | Read is authenticated workspace access; create/update/delete require explicit building/room permissions. Full facility visibility is required by PRD. |
| `/api/inventory/rooms/[id]` | `id` | Update/delete are administrator-only through room-manage permission. |
| `/api/inventory/items/[id]` | `id` | Every operation resolves the current account and passes an authorization actor into the item service. Full registry visibility for all staff is explicitly required by PRD; mutations remain administrator-only. |
| `/api/inventory/items/[id]/audit` | `id` | Protected audit requires `inventory.item.manage_protected_fields` (administrator). |
| `/api/inventory/items/[id]/photo` | `id` | Read/write pass parent-item access checks; write requires item edit permission. |
| `/api/inventory/items/[id]/qr` | `id` | Parent item is checked; QR management is permission-bound. |
| `/api/inventory/items/[id]/comments` | `id` | Parent item read is checked; add-comment has a separate permission. |
| `/api/inventory/items/[id]/comments/[commentId]/attachments/[attachmentId]` | three UUIDs | One repository query binds attachment to both comment and parent item; service checks parent read access. |
| `/api/inventory/items/[id]/components` and `/candidates` | item/component IDs | Parent and counterpart items are resolved; mutation is administrator-only and self/cyclic-invalid relations are rejected. |
| `/api/inventory/items/[id]/responsibility` and `/accept` | `id` | Timeline follows item-read policy; acceptance is employee-only and checks current item state transactionally. |
| `/api/inventory/inspections/[id]/rooms` | `id`, room IDs in body | Service checks technician ownership or admin authority from database relationships. |
| `/api/inventory/inspections/[id]/rooms/[roomId]/results` | `id`, `roomId`, item IDs in body | Inspection, room, technician, and item relationships are checked inside the service/unit of work. |
| `/api/inventory/transfers/[id]/decision` | `id` | Only the snapshotted current responsible employee can decide; foreign and absent IDs now have the same response. |
| `/api/inventory/transfers/[id]/cancel` | `id` | Only the requester can cancel; foreign and absent IDs now have the same response. |
| `/api/inventory/transfers/[id]/override` | `id` | Administrator-only before object lookup, with required reason and optimistic version. |
| `/api/inventory/qr/resolve?value=` | high-entropy QR token or barcode | Authenticated and role-filtered response; now covered by the common limiter. |

The remaining practical enumeration surface is authenticated bulk listing, not
sequential numeric ID guessing. It must be addressed with pagination, audit-based
abuse detection, and a distributed limiter rather than by replacing UUIDs.

## Remediation plan

1. **P0, before multi-instance production:** move rate-limit buckets and password-reset challenges to Redis or a transactional database table. Use atomic increment/expiry and one-time compare-and-delete. Preserve the current per-IP and per-account namespaces.
2. **P0, before public exposure:** configure the ingress to delete client-supplied forwarding headers and set exactly one trusted client-IP header. Add a startup/deployment check for the chosen proxy mode.
3. **P0, session containment:** add `session_version` or `sessions_revoked_at` to users. Include the version in signed session payloads and compare it on every request. Increment it on password change, account deactivation, privileged role change, and explicit logout-all.
4. **P1, enumeration and resource control:** add cursor pagination and hard page-size ceilings to items, users, audit, comments, inspections, and transfers. Apply endpoint-cost weights to export, Excel parsing, QR resolution, and photo processing.
5. **P1, gateway body limits:** reject excessive `Content-Length` early and configure ingress limits for JSON, multipart, and Excel separately. Stream uploads where possible and keep the existing ZIP expansion checks.
6. **P1, detection:** emit structured security events for `401`, `403`, object-hidden `404`, `429`, reset failures, and high unique-ID counts. Alert when one actor probes many distinct UUIDs or QR values.
7. **P1, CSP:** inventory 2GIS and Next browser origins, implement nonce-based CSP, remove `unsafe-inline` requirements where possible, and add Playwright checks for CSP violations.
8. **P2, privacy:** replace comment `authorEmail` with display name for non-admin roles unless the product owner documents an operational need. Add response-shape tests per role.
9. **P2, continuous assurance:** run `npm audit --omit=dev`, full `npm audit`, lint, tests, build, secret scanning, and SAST in CI. Fail releases on critical/high production advisories and review overrides on every dependency update.

## Verification evidence

- `npm audit --json`: 0 vulnerabilities.
- `npm audit --omit=dev --json`: 0 vulnerabilities.
- Unit tests with React server condition: 115 passed, 0 failed.
- New security tests: 3 passed, 0 failed.
- ESLint: 0 errors, 2 pre-existing warnings in the production-monitor script.
- `next build`: successful with Next.js 16.2.11.
- Standalone `tsc --noEmit`: blocked by pre-existing test typing errors; the Next production build TypeScript phase passes.

# YU Inventory — Dockflow API

The integration is server-to-server and read-only. Dockflow must call the production HTTPS base URL and must not expose the API key to browser code. CORS headers are intentionally absent.

## Employee clearance check

```http
GET /api/integrations/dockflow/employee?iin=900101300123&fullName=Иванов%20Иван%20Иванович&email=i.ivanov@example.kz
X-API-Key: df_live_<secret>
Accept: application/json
```

All three query parameters are required. `iin` is exactly 12 digits. `fullName` is compared case-insensitively after trimming and collapsing whitespace. `email` is trimmed, lowercased and compared exactly. An unknown IIN and a mismatch of name or email deliberately produce the same `404 EMPLOYEE_NOT_FOUND` response.

Successful responses use HTTP 200. `canProceed` is `true` only for `CLEAR`; every open responsibility period, pending handover, loss payment, receipt review or inconsistent obligation keeps it `false`. Only currently active items are returned. Receipt files, internal attachment links and completed history are never returned.

Business statuses, in descending blocking priority:

1. `BLOCKED`
2. `ACCOUNTING_REVIEW_PENDING`
3. `LOSS_PAYMENT_PENDING`
4. `RETURN_IN_PROGRESS`
5. `HANDOVER_IN_PROGRESS`
6. `ASSETS_ASSIGNED`
7. `CLEAR`

Individual `items[].status` values use the separate stable item contract:
`ASSIGNED`, `TRANSFER_PENDING`, `RETURN_PENDING`, `LOST`,
`PAYMENT_PENDING`, `RECEIPT_SUBMITTED`, or `ACCOUNTING_VERIFIED`.

Errors use stable codes:

| HTTP | Code | Meaning |
|---:|---|---|
| 400 | `INVALID_REQUEST` | Missing or invalid query parameter |
| 401 | `INVALID_API_KEY` | Missing, unknown or revoked key |
| 404 | `EMPLOYEE_NOT_FOUND` | Employee identity was not matched |
| 500 | `INTERNAL_ERROR` | Unexpected internal failure |
| 503 | `SERVICE_UNAVAILABLE` | Database or dependent service unavailable |

Every response is UTF-8 JSON, contains `requestId`, and includes `Cache-Control: no-store`. The OpenAPI 3.1 contract is in [dockflow-openapi.yaml](dockflow-openapi.yaml).

## Key lifecycle and operations

An administrator issues, rotates or revokes the single active key under **Settings → API integrations → Dockflow**. A generated key contains at least 256 bits of entropy and is shown once. PostgreSQL stores only its visible prefix and SHA-256 digest. Rotation revokes the previous key in the same transaction.

For initial deployment only, `DOCKFLOW_API_KEY` may provide a secret from the deployment secret store. Remove it after the database-backed key has been securely delivered.

The Nginx production configuration disables access logging for the exact employee endpoint because the agreed GET contract places personal data in the query string. Application audit rows contain only the request ID, time, key identifier/prefix, result, HTTP status and duration. An administrator configures retention (1–3650 days) and whether the visible key prefix is included under the Dockflow settings panel; the internal key ID remains available when the prefix is disabled. Expired rows are deleted automatically while new requests are journaled.

Before go-live, Dockflow must confirm that calls originate from its backend. If a browser flow is later requested, agree an explicit HTTPS origin allowlist and replace the long-lived browser-visible credential design before enabling CORS.

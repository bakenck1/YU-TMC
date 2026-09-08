# Asset-loss API decision and contract

Decision date: 2026-09-08. Owner: inventory/accounting product owner.

The workflow remains active as an API-only vertical for first-party clients:
an authenticated employee creates a case for an item currently assigned to
them and submits a payment receipt; an administrator with
`inventory.item.manage_protected_fields` acts as accounting reviewer. There is
no confirmed browser UI consumer in this repository, so UI acceptance is
deliberately deferred to a product task with a defined user journey.

## Safety defaults

- An employee cannot create or inspect another employee's case. An
  administrator may create on behalf of an employee and inspect all cases.
- Creation snapshots the exact responsibility-period ID on the case. Approval
  succeeds only while the employee is active and that same period is still the
  current period belonging to the employee captured by the case; ending and
  reassigning to the same person is therefore still detected as a change.
  Otherwise the whole operation returns `409 loss_responsibility_changed` and
  neither the case nor responsibility changes.
- Approval closes responsibility; it does not decommission or otherwise change
  the item lifecycle. A separate explicit inventory action owns that decision.
- A rejected case may receive a replacement receipt. Replacement and marking
  the prior photo `superseded` are atomic. Superseded financial evidence stays
  in the photo retention lifecycle and is never hard-deleted by this API.
- Case events form a continuous, append-only database-enforced state chain.

## HTTP contract

`GET /api/inventory/loss-cases?cursor=<opaque>` returns at most 100 cases as
`{ lossCases, nextCursor }`. Employees see their own cases; administrators see
all. Supplying an unknown or repeated query parameter fails closed.

`POST /api/inventory/loss-cases` accepts only `itemId`, optional `employeeId`,
and optional decimal-string `amount`. `POST /[id]/receipt` accepts exactly one
normalized JPEG data URL. `POST /[id]/review` accepts `decision` and optional
`comment`; rejection requires a comment.

Mutation bodies are bounded, UUIDs and unknown fields are rejected, all
responses are `private, no-store`, and unexpected persistence errors map to a
stable `503` code without SQL details.

The mutations are deliberately non-idempotent: clients must not automatically
retry an ambiguous response. State guards and the single-open-case constraint
make duplicate execution fail with `409`, while a subsequent receipt is only
allowed after an explicit rejection. Adding idempotency keys requires a future
contract version and durable replay records.

The forward migration backfills the responsibility snapshot from the period
that covered each legacy case's creation time. It aborts with an explicit
constraint error when an open case cannot be matched safely; closed historical
cases may retain a null snapshot because they can no longer be reviewed.

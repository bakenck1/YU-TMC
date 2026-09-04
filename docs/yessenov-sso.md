# Yessenov ID SSO

YU Inventory uses Yessenov ID as an OpenID Connect confidential client. A
successful first login creates a local active user with the `employee` role.
Administrators assign `warehouse` or `admin` later in the Users panel; identity
provider claims never grant those roles.

## Identity-provider registration

Register these exact values with the Yessenov ID administrators:

- Application entry URL: `https://<inventory-host>/api/auth/yessenov`
- Redirect URI: `https://<inventory-host>/api/auth/yessenov/callback`
- Scopes: `openid profile email`
- ID-token signing algorithm: `RS256`
- Required claims: `sub`, `email`, `email_verified`, `name`, `is_personnel`
- Optional employee claim: `iin`

Store the issued values only in the deployment secret store:

```dotenv
YESSENOV_OIDC_CLIENT_ID=...
YESSENOV_OIDC_CLIENT_SECRET=...
YESSENOV_OIDC_REDIRECT_URI=https://<inventory-host>/api/auth/yessenov/callback
```

The callback accepts only verified `@yu.edu.kz` employee identities. It links
an existing local profile by normalized email, then permanently identifies the
account by the provider's `sub` value. A deactivated local user remains blocked.
When Yessenov SSO is configured, an unauthenticated visit to `/login`
automatically starts this flow. If the provider already has an active session,
the user returns directly to Inventory without seeing another login button.
Administrators can reach the emergency local sign-in form at `/login?manual=1`;
callback errors also stop automatic redirection so they cannot create a loop.
On each successful login, verified `phone_number`, `orgunit`, `position`, and
`tutor_id` claims refresh the local personnel profile. A valid IIN is filled
only when no other active user owns it. Provider claims never change the local
application role.

## Dockflow employee directory

The real Dockflow endpoints read employee profiles from
`https://api.yu.edu.kz/api/v2/personnels/`. Ask the Yessenov University API
administrators for a service token with read-only access to that endpoint and
store it only in the deployment secret store. The application sends it in the
`Authorization: Token <token>` header:

```dotenv
YESSENOV_DIRECTORY_API_TOKEN=...
```

`GET /api/v1/employees` follows the Yessenov API pagination. Employee lookup
uses its `search` filter and then requires an exact match against
`identify_code`; inventory assignments and item counts are joined
from PostgreSQL by that IIN. Only the Dockflow profile fields are exposed. The
integration deliberately omits recovery email, addresses, identity-document
details, birth date, custom data and permissions. The directory token is sent
only to the fixed HTTPS host `api.yu.edu.kz`, including validated pagination
links, and is never forwarded from a caller-provided URL.

The same directory powers the application's **Users** page. Every server-side
load of `/users` and every `GET /api/users` request fetches every page with
`cache: "no-store"`, then inserts missing active personnel and refreshes their
full name, IIN (`identify_code`), department, position, personnel ID,
phone and verified-email state before returning the list. New directory users
receive the least-privileged local `employee` role. Existing local roles,
activation state and login email are never overwritten; Yessenov roles and the
current Yessenov email are shown as directory information only. This prevents
a provider-side role such as `admin` from granting application permissions.

The synchronization is serialized in PostgreSQL so concurrent page loads do
not create duplicate users. Directory records with an invalid IIN/email,
inactive account/personnel status, or a conflicting local email/IIN are skipped
instead of overwriting an unrelated account.

## Personnel JSON import

The personnel export is an initial roster/backfill, not an authentication
credential. Keep the source file outside Git. First inspect a summary without
changing the database:

```powershell
npm run db:import-personnel -- --target=development --source="C:\path\Personnel.json"
```

After reviewing the counts and applying all database migrations, import it:

```powershell
npm run db:import-personnel -- --target=development --source="C:\path\Personnel.json" --apply
```

Only active, successfully synchronized staff with a unique corporate email are
eligible. New users receive the `employee` role. Existing roles and names are
never overwritten. A unique valid IIN is filled when safe; duplicate or invalid
IIN values are left empty for manual review. The command prints counts only and
does not log personal data.

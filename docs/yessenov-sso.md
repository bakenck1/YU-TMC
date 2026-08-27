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

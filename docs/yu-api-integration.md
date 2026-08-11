# YU API integration

`project/` is a separate Django/DRF service, not a package that should be
compiled into the Next.js application. YU-TMC communicates with the running
service over HTTP. The local checkout is ignored by the parent repository
because it contains its own Git metadata, `.env`, database files, logs,
virtual environment and personal-data exports.

## What YU API provides to YU-TMC

The first integration uses the existing `GET /api/v2/personnels/` endpoint as
the authoritative university personnel directory. In **Users → Create user**,
an administrator can search by name or corporate email and copy only these
fields into a new local YU-TMC profile:

- YU API personnel ID;
- full name;
- corporate email;
- work or mobile phone.

IIN, documents, birth dates, custom user data, permissions and other sensitive
fields returned by the legacy serializer are deliberately discarded. The
local YU-TMC role is selected separately and is never inherited from YU API.

## Configuration

1. Run the Django service from `project/`. Its Docker Compose stack publishes
   nginx on `${NGINX_PORT:-80}`. If `NGINX_PORT=8000`, the local base URL is
   `http://127.0.0.1:8000`. With the current checked-in `.env`, nginx is
   published on port 80, so use `http://127.0.0.1`.
2. Provision a dedicated local service account and token automatically:

   ```powershell
   npm run integration:yu-api:provision
   ```

   The command creates or repairs `yu_tmc_service`, removes its groups, staff
   and superuser flags, grants only `core.view_personnel`, creates an
   `APIToken`, and stores the secret in YU-TMC `.env.local` without printing it.
3. For production, create the same least-privileged account in the deployed YU
   API and add these server-side values to the deployment secret store:

   ```dotenv
   YU_API_BASE_URL=http://127.0.0.1
   YU_API_DOCKER_BASE_URL=http://host.docker.internal
   YU_API_TOKEN=<dedicated service token>
   YU_API_TIMEOUT_MS=5000
   ```

The token is attached by the server as `Authorization: Token ...`; it is never
included in client JavaScript or returned to the browser.

For the mobile Docker stack, the project start command automatically uses
`.env.local` as the Compose interpolation source. The file is not copied into
the image, and the token is passed only to the server-side app container:

```powershell
npm run docker:mobile:up
```

`YU_API_DOCKER_BASE_URL` uses Docker Desktop's host gateway because
`127.0.0.1` inside the Next.js container refers to that container, not to the
Django service running on the host.

## Boundaries

YU API remains the source of truth for university directory data. PostgreSQL
used by YU-TMC remains the source of truth for inventory roles, permissions,
responsibility periods, transfers and audit history. This prevents a failure
or overly broad role in the legacy platform from silently changing inventory
authorization.

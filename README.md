This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

`npm run dev` uses `DATABASE_URL` when it is configured. Otherwise it starts a
persistent embedded PostgreSQL instance in `%LOCALAPPDATA%/YUInventory/postgres-development`,
applies migrations, imports the existing local credential, and then starts
Next.js. Docker is not required for this local fallback.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

### Google Workspace SSO

Create a Google Cloud OAuth 2.0 client of type **Web application** and register
the exact callback URL:

```text
http://localhost:3000/api/auth/google/callback
```

Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and
`GOOGLE_WORKSPACE_DOMAIN=yu.edu.kz` in `.env.local`. Production callback URLs
must use HTTPS. A verified Workspace user is created as an active `employee` on
the first sign-in; an administrator can then change the role or deactivate the
account.
The callback verifies the ID token, nonce, audience, verified email, and
Workspace `hd` claim before creating the application session.

### Web Push

Generate one VAPID key pair and store it in the deployment secret store:

```bash
npx web-push generate-vapid-keys --json
```

Set `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, and
`WEB_PUSH_VAPID_SUBJECT` (an HTTPS URL or `mailto:` contact). After installing
the PWA, each technician enables notifications on the Inventory page. The
subscription is bound to the signed-in account and removed from the device on
logout.

Assignment notifications are best-effort: the inspection is committed first
and is never rolled back because a push provider is unavailable. Transient
network, HTTP 429, and HTTP 5xx failures are retried up to three times in a
Next.js `after()` callback, so delivery does not delay the creation response.
Final delivery and subscription-cleanup failures are written to the server
error log. This keeps the inventory workflow authoritative while making push
failures observable, but it is not a durable delivery queue. Self-hosted
deployments must use graceful `SIGINT`/`SIGTERM` shutdown so pending `after()`
callbacks can finish.

PostgreSQL setup, environment isolation, migration commands, and production
deployment rules are documented in [docs/database.md](docs/database.md).

### Запуск в Docker для телефона

Docker Desktop запускает приложение и PostgreSQL одной командой:

```powershell
docker compose -f docker-compose.mobile.yml up --build -d
```

Откройте `http://<IP-адрес-компьютера>:3000` на телефоне, подключённом к той
же Wi‑Fi сети. Узнать адрес компьютера можно командой `ipconfig` (строка
`IPv4 Address`). Логи и остановка:

```powershell
docker compose -f docker-compose.mobile.yml logs -f app
docker compose -f docker-compose.mobile.yml down
```

Данные PostgreSQL сохраняются в Docker volume, а `.data` монтируется из
проекта, поэтому текущий администратор и настройки сохраняются между
перезапусками.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

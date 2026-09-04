# Dockflow API

The integration is exposed by the application itself:

- Swagger UI: `GET /api`
- OpenAPI 3.1: `GET /api/openapi.json`
- API base path: `/api/v1`

Set `DOCKFLOW_API_KEY` in the application environment and obtain a read-only
Yessenov ID service token for `GET https://id.yu.edu.kz/api/users/` as
`YESSENOV_DIRECTORY_API_TOKEN`.
Swagger's **Authorize** dialog expects the key value without the `Bearer` prefix.
Direct HTTP clients send it as:

```http
Authorization: Bearer <TEST_API_KEY>
```

Example:

```bash
curl -H "Authorization: Bearer $DOCKFLOW_API_KEY" \
  http://localhost:3000/api/v1/employees/000000000000
```

Employee profiles are loaded server-side from Yessenov ID and filtered to
active personnel with a valid 12-digit `personnel.identify_code`. Current TMC,
assignment and quantity data is read from PostgreSQL and joined by that IIN.
The Yessenov service token is not accepted from Dockflow callers and is never
returned to the browser.

The fixture demonstrates the marking and quantity model: one batch card and
one barcode cover 50 chairs. Assignments may contain any positive quantities
for any number of recipients, and `availableQuantity` is calculated as the
unassigned remainder. The fixture values are examples, not a fixed 7/3 rule.
`markingType` has the values `individual`, `batch`, and
`package_or_storage`.

## Как увидеть API локально

1. Добавить в локальный `.env.local` отдельную строку:

   ```env
   DOCKFLOW_API_KEY=dockflow-local-key
   YESSENOV_DIRECTORY_API_TOKEN=<issued-read-only-service-token>
   ```

2. Установить зависимости и запустить приложение:

   ```powershell
   npm ci
   npm run dev:next
   ```

   Для API нужна PostgreSQL, поэтому используйте `npm run dev` либо отдельно
   настройте `DATABASE_URL` перед `npm run dev:next`.

3. Открыть в браузере `http://localhost:3000/api`.
4. Нажать **Authorize**, вставить `dockflow-local-test-key` без слова
   `Bearer`, затем выполнить любой метод через **Try it out**.

Проверка без Swagger:

```powershell
$headers = @{ Authorization = "Bearer dockflow-local-key" }
Invoke-RestMethod `
  -Headers $headers `
  -Uri "http://localhost:3000/api/v1/employees/000000000000"
```

`GET /api/v1/auth/check` должен вернуть `{ "valid": true }`. Неизвестный
12-значный ИИН должен вернуть `404 EMPLOYEE_NOT_FOUND`, а запрос без ключа —
`401 UNAUTHORIZED`.

## GitHub и развёртывание

API является частью того же Next.js-приложения. Отдельно загружать его «в сайт»
не нужно: после развёртывания новой версии приложения Swagger автоматически
будет доступен по `https://<домен>/api`, а методы — по
`https://<домен>/api/v1/...`.

В репозитории настроен GitHub Actions workflow только для тестов и сборки.
Автоматического deployment job сейчас нет. Поэтому `git push` отправит код в
GitHub и запустит проверки, но сам по себе production-сервер не обновит.

Рекомендуемый порядок:

1. Проверить API локально.
2. Закоммитить изменения и отправить их в согласованный GitHub remote/branch.
3. Дождаться зелёного workflow **Reliable test suite**.
4. На тестовом сервере получить эту версию репозитория, задать секрет
   `DOCKFLOW_API_KEY`, `YESSENOV_DIRECTORY_API_TOKEN` и остальные обязательные
   production-переменные.
5. На сервере обновить код, пересобрать приложение и выполнить штатные
   production-проверки:

   ```bash
   cd /opt/yu-inventory/current
   git pull origin master
   npm ci
   npm run build
   npm run db:migrate -- --target=production
   npm run db:import-settings -- --target=production
   npm run db:smoke -- --target=production
   sudo systemctl restart yu-inventory yu-inventory-push-worker
   ```

6. Убедиться, что systemd-сервисы работают, а внешний Nginx направляет HTTPS-
   домен на `127.0.0.1:3000`:

   ```bash
   sudo systemctl status yu-inventory yu-inventory-push-worker
   ```
7. Проверить снаружи:

   ```bash
   curl -H "Authorization: Bearer $DOCKFLOW_API_KEY" \
     https://<домен>/api/v1/auth/check
   ```

Сначала следует использовать тестовый сервер. Для production выдайте Dockflow
отдельный ключ, а Yessenov ID — отдельный read-only service token; не используйте
для этих двух границ один и тот же секрет.

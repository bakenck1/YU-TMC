# Развёртывание YU Inventory

Эта инструкция рассчитана на Ubuntu Server 22.04/24.04, Node.js 24.15.x, PostgreSQL
16+ и Nginx. Приложение запускается как два systemd-сервиса: web-приложение и
фоновый обработчик push-уведомлений; резервное копирование запускается отдельным
systemd-сервисом по timer.

## Подготовка сервера

1. Создайте системного пользователя и каталоги:

   ```bash
   sudo useradd --system --create-home --home-dir /opt/yu-inventory --shell /usr/sbin/nologin yu-inventory
   sudo install -d -o yu-inventory -g yu-inventory /opt/yu-inventory/current
   sudo install -d -m 0700 /etc/yu-inventory
   ```

2. Установите Node.js 24.15.x, PostgreSQL 16+ и Nginx. Нужны команды `node`, `npm`,
   `psql`, `pg_dump`, `pg_restore`, `openssl`, `flock` и `nginx`.
3. Создайте отдельную production-базу и две роли PostgreSQL: ограниченную
   runtime-роль и migrator-роль для миграций. База не должна быть доступна из
   публичного интернета.
4. Скопируйте исходный код в `/opt/yu-inventory/current` и передайте владение
   пользователю `yu-inventory`.

## Секреты

Создайте `/etc/yu-inventory/yu-inventory.env` и выполните
`sudo chmod 600 /etc/yu-inventory/yu-inventory.env`. Файл должен содержать
production-переменные из `.env.example`, включая `DATABASE_URL`,
`DATABASE_MIGRATOR_URL`, `DATABASE_DEPLOYMENT_ID`, `DATABASE_SSL_MODE`,
`SESSION_SECRET`, `APP_PUBLIC_ORIGIN`, `TRUSTED_CLIENT_IP_HEADER` и все три
`WEB_PUSH_VAPID_*` переменные. Для входа через Yessenov ID также задайте
`YESSENOV_OIDC_CLIENT_ID`, `YESSENOV_OIDC_CLIENT_SECRET` и точный HTTPS
`YESSENOV_OIDC_REDIRECT_URI`. Для реального Dockflow API также нужны отдельный
`DOCKFLOW_API_KEY` и выданный Yessenov University read-only service-токен
`YESSENOV_DIRECTORY_API_TOKEN` для `GET https://api.yu.edu.kz/api/v2/personnels/`.
Для TLS БД с частным CA укажите сертификат в
`DATABASE_SSL_CA` одной строкой с экранированными переводами строки (`\n`).
Backup читает только database-переменные из строк формата `KEY=value`; он не
исполняет содержимое env-файла как shell-код.

## Первый запуск

Выполните от имени `yu-inventory`:

```bash
cd /opt/yu-inventory/current
npm ci
npm run build
npm run db:migrate -- --target=production
npm run db:import-settings -- --target=production
npm run db:smoke -- --target=production
mkdir -p .next/cache
```

Если нужно перенести настройки со старой версии, вместо обычного импорта
выполните `npm run db:import-settings -- --target=production --source=/secure/path/settings.json`.

Скопируйте unit-файлы из `deploy/systemd/` в `/etc/systemd/system/`, затем:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now yu-inventory yu-inventory-push-worker
sudo systemctl status yu-inventory yu-inventory-push-worker
```

Установите `deploy/backup-postgres.sh` как
`/usr/local/sbin/yu-inventory-backup`, создайте закрытый каталог
`/var/backups/yu-inventory`, затем включите
`yu-inventory-backup.timer`. Таймер ежедневно создаёт проверенный custom-format
дамп PostgreSQL и удаляет только дампы YU Inventory старше 30 дней:

```bash
sudo install -d -o root -g root -m 0700 /var/backups/yu-inventory
sudo install -d -o root -g root -m 0755 /usr/local/libexec
sudo install -o root -g root -m 0750 deploy/backup-postgres.sh /usr/local/sbin/yu-inventory-backup
sudo install -o root -g root -m 0644 deploy/backup-postgres-connection.mjs \
  /usr/local/libexec/yu-inventory-backup-connection.mjs
sudo systemctl enable --now yu-inventory-backup.timer
sudo systemctl start yu-inventory-backup.service
```

Для production `DATABASE_MIGRATOR_URL` должен быть query-free URL без
`sslmode` или других параметров подключения. Скрипт вынимает пароль во
временный root-only `PGPASSFILE`, передаёт `pg_dump` URL без пароля и использует
`DATABASE_SSL_MODE` (по умолчанию `verify-full`). Локальный dump на том же
сервере не является аварийной копией: до релиза его нужно зашифрованно
скопировать во внешнее хранилище и проверить восстановление в отдельную БД.
Перед `pg_dump` скрипт проверяет `DATABASE_DEPLOYMENT_ID` через schema contract
по обеим ролям (`DATABASE_URL` и `DATABASE_MIGRATOR_URL`), поэтому backup из
другого кластера с тем же именем базы не считается успешным.

## Nginx и HTTPS

До получения сертификата установите
`deploy/nginx/yu-inventory-http.conf` как временную конфигурацию сайта. После
получения сертификата университета установите `deploy/enable-https.sh` и
передайте ему каталог с файлами `cert.pem`, `chain.pem`, `fullchain.pem` и
`privkey.pem`:

```bash
sudo install -d -o root -g root -m 0755 /var/www/certbot
# Отключите стандартный сайт Ubuntu, если он включён.
sudo unlink /etc/nginx/sites-enabled/default 2>/dev/null || true
sudo install -o root -g root -m 0644 deploy/nginx/yu-inventory-http.conf \
  /etc/nginx/sites-available/yu-inventory.conf
sudo ln -sfn /etc/nginx/sites-available/yu-inventory.conf \
  /etc/nginx/sites-enabled/yu-inventory.conf
sudo nginx -t
sudo systemctl reload nginx

sudo install -d -o root -g root -m 0700 /etc/yu-inventory
sudo install -o root -g root -m 0644 deploy/nginx/yu-inventory.conf \
  /etc/yu-inventory/yu-inventory.conf
sudo install -o root -g root -m 0750 deploy/enable-https.sh /usr/local/sbin/yu-inventory-enable-https
sudo /usr/local/sbin/yu-inventory-enable-https /secure/path/certs/yu.edu.kz
```

Каталог сертификатов должен принадлежать `root`, не быть симлинком или
доступным на запись группе/остальным пользователям; исходный `privkey.pem`
должен иметь права `0400` или `0600`. До установки сертификата
временная конфигурация отдаёт только ACME challenge и возвращает `404` для
остальных HTTP-запросов — логин и операции не передаются по незашифрованному
каналу. В `chain.pem` должен находиться доверенный CA bundle в порядке
`intermediate -> root`, а первым
сертификатом в `fullchain.pem` должен быть тот же leaf, что и в `cert.pem`.

Скрипт проверяет срок действия, доменное имя, цепочку и соответствие приватного
ключа, устанавливает ключ с правами `0600`, включает готовую HTTPS-конфигурацию
и перезагружает Nginx. Он также переключает симлинк `sites-enabled` на HTTPS и
автоматически возвращает предыдущие сертификаты и конфигурацию, если `nginx -t`
или reload не прошли. Перед истечением сертификата замените четыре исходных
файла и повторно запустите ту же команду. Важно сохранять временную HTTP- и
боевую HTTPS-конфигурации под одним именем `yu-inventory.conf`, чтобы в Nginx не
оставались два конкурирующих `server`-блока. При ручной настройке скопируйте
`deploy/nginx/yu-inventory.conf` в `/etc/nginx/sites-available/`, сохраните тот же
боевой файл отдельно в `/etc/yu-inventory/yu-inventory.conf`, отключите стандартный
сайт Ubuntu и включите сайт
и проверьте конфигурацию:

```bash
sudo unlink /etc/nginx/sites-enabled/default 2>/dev/null || true
sudo install -d -o root -g root -m 0700 /etc/yu-inventory
sudo install -o root -g root -m 0644 deploy/nginx/yu-inventory.conf \
  /etc/yu-inventory/yu-inventory.conf
sudo install -o root -g root -m 0644 deploy/nginx/yu-inventory.conf \
  /etc/nginx/sites-available/yu-inventory.conf
sudo ln -sfn /etc/nginx/sites-available/yu-inventory.conf /etc/nginx/sites-enabled/yu-inventory.conf
sudo nginx -t
sudo systemctl reload nginx
```

Nginx должен быть единственным публичным входом: открыты TCP 80/443, а порт
3000 доступен только на `127.0.0.1`. Конфигурация пропускает запросы до 11 МБ,
чтобы прикладной лимит фотографии 5 MiB применялся самим приложением; также
она отключает proxy buffering для streaming и перезаписывает `X-Real-IP`.

## Обновление

1. Сделайте и проверьте резервную копию PostgreSQL.
2. Остановите web и worker: `sudo systemctl stop yu-inventory yu-inventory-push-worker`.
3. Обновите код в `/opt/yu-inventory/current`, затем от имени `yu-inventory`
   выполните `npm ci`, `npm run build`, `npm run db:migrate -- --target=production`,
   `npm run db:import-settings -- --target=production` и
   `npm run db:smoke -- --target=production`.
4. Выполните `sudo systemctl restart yu-inventory yu-inventory-push-worker`.
5. Проверьте `https://<домен>/login` и `journalctl -u yu-inventory -u yu-inventory-push-worker -n 100`.

Не удаляйте релиз до подтверждения работы. Откат схемы БД делается только
проверенным восстановлением бэкапа или новой исправляющей миграцией.

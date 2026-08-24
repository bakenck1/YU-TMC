# Развёртывание YU Inventory без Docker

Эта инструкция рассчитана на Ubuntu Server 22.04/24.04, Node.js 22, PostgreSQL
16+ и Nginx. Приложение запускается как два systemd-сервиса: web-приложение и
фоновый обработчик push-уведомлений.

## Подготовка сервера

1. Создайте системного пользователя и каталоги:

   ```bash
   sudo useradd --system --create-home --home-dir /opt/yu-inventory --shell /usr/sbin/nologin yu-inventory
   sudo install -d -o yu-inventory -g yu-inventory /opt/yu-inventory/current
   sudo install -d -m 0700 /etc/yu-inventory
   ```

2. Установите Node.js 22, PostgreSQL 16+ и Nginx. Нужны команды `node`, `npm`,
   `psql` и `nginx`.
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
`WEB_PUSH_VAPID_*` переменные. Для TLS БД с частным CA укажите сертификат в
`DATABASE_SSL_CA` одной строкой с экранированными переводами строки (`\n`).

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

## Nginx и HTTPS

До включения Nginx-сайта замените `inventory.yu.edu.kz` на реальный домен и
получите сертификат (порт 80 в этот момент не должен быть занят):

```bash
sudo certbot certonly --standalone -d inventory.yu.edu.kz
```

После этого скопируйте `deploy/nginx/yu-inventory.conf` в
`/etc/nginx/sites-available/`, включите сайт и проверьте конфигурацию:

```bash
sudo ln -s /etc/nginx/sites-available/yu-inventory.conf /etc/nginx/sites-enabled/yu-inventory.conf
sudo nginx -t
sudo systemctl reload nginx
```

Nginx должен быть единственным публичным входом: открыты TCP 80/443, а порт
3000 доступен только на `127.0.0.1`. Конфигурация уже ограничивает загрузку до
8 МБ, отключает proxy buffering для streaming и перезаписывает `X-Real-IP`.

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

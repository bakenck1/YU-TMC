#!/usr/bin/env bash
set -Eeuo pipefail
trap 'printf "Update failed at line %s. Fix the reported error and rerun; services may remain stopped.\n" "$LINENO" >&2' ERR

if [[ "${EUID}" -ne 0 ]]; then
  echo 'Run with sudo bash deploy/update-integration-api.sh.' >&2
  exit 1
fi

cd /opt/yu-inventory/current
if [[ -n "$(sudo -u yu-inventory git status --porcelain)" ]]; then
  echo 'The server checkout has local changes. Preserve them before updating.' >&2
  sudo -u yu-inventory git status --short
  exit 1
fi
test -f lib/server/integration-auth.ts
test -f drizzle/20261106111248_integration-events.sql
test -r /etc/yu-inventory/yu-inventory.env

echo '[1/4] Backing up the database before stopping services'
systemctl start yu-inventory-backup.service
test "$(systemctl show yu-inventory-backup.service -p Result --value)" = success
test "$(systemctl show yu-inventory-backup.service -p ExecMainStatus --value)" = 0

echo '[2/4] Preparing the existing protected runtime environment'
node deploy/prepare-runtime-env.mjs /etc/yu-inventory/yu-inventory.env /etc/yu-inventory/yu-inventory-runtime.env
systemctl stop yu-inventory yu-inventory-push-worker
# Restore the runtime-only environment even if migration/build fails. Never
# leave migrator credentials in a file Next can read on the next restart.
trap 'install -o yu-inventory -g yu-inventory -m 600 /etc/yu-inventory/yu-inventory-runtime.env /opt/yu-inventory/current/.env.production.local' EXIT
install -o yu-inventory -g yu-inventory -m 600 /etc/yu-inventory/yu-inventory.env .env.production.local

echo '[3/4] Installing dependencies, migrating and building'
sudo -u yu-inventory bash <<'UPDATE'
set -euo pipefail
cd /opt/yu-inventory/current
npm ci --include=dev
npm run db:migrate -- --target=production
npm run db:smoke -- --target=production
npm run build
mkdir -p .next/cache
UPDATE

install -o yu-inventory -g yu-inventory -m 600 /etc/yu-inventory/yu-inventory-runtime.env .env.production.local
trap - EXIT
install -o root -g root -m 644 deploy/systemd/yu-inventory.service /etc/systemd/system/yu-inventory.service
install -o root -g root -m 644 deploy/systemd/yu-inventory-push-worker.service /etc/systemd/system/yu-inventory-push-worker.service
systemctl daemon-reload

echo '[4/4] Restarting and checking the site'
systemctl restart yu-inventory yu-inventory-push-worker
systemctl is-active --quiet yu-inventory
systemctl is-active --quiet yu-inventory-push-worker
curl --fail --silent --show-error --output /dev/null --max-time 15 --retry 10 --retry-delay 1 --retry-connrefused --retry-max-time 30 https://inventory.yu.edu.kz/login
sudo -u yu-inventory git log -1 --format='Installed commit: %h %cI %s'
echo 'Read-only integration update complete. API access requires a configured read key.'

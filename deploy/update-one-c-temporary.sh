#!/usr/bin/env bash
set -Eeuo pipefail
trap 'printf "Update failed at line %s. Services may remain stopped; fix the reported error and rerun.\n" "$LINENO" >&2' ERR

if [[ "${EUID}" -ne 0 ]]; then
  echo 'Run this script with sudo bash.' >&2
  exit 1
fi

cd /opt/yu-inventory/current
echo '[1/5] Checking the deployed source'
sudo -u yu-inventory git log -1 --format='%h %s'
working_changes=$(sudo -u yu-inventory git status --porcelain)
if [[ -n "$working_changes" ]]; then
  echo 'Update not started: the server checkout has local changes:' >&2
  sudo -u yu-inventory git status --short
  echo 'Review and preserve these changes before updating. No files were removed and no services were stopped.' >&2
  exit 1
fi
echo '[2/5] Creating and checking the database backup'
systemctl start yu-inventory-backup.service
test "$(systemctl show yu-inventory-backup.service -p Result --value)" = success
test "$(systemctl show yu-inventory-backup.service -p ExecMainStatus --value)" = 0
echo '[3/5] Stopping services'
systemctl stop yu-inventory yu-inventory-push-worker

# systemd reads the existing protected environment without copying its secrets.
echo '[4/5] Installing, building and reconciling temporary cards'
systemd-run --wait --pipe --collect \
  --uid=yu-inventory \
  --working-directory=/opt/yu-inventory/current \
  --property=EnvironmentFile=/etc/yu-inventory/yu-inventory.env \
  --setenv=NODE_ENV=production \
  /bin/bash -c 'set -euo pipefail
    npm ci --include=dev
    npm run db:migrate -- --target=production
    npm run db:smoke -- --target=production
    npm run build
    npm run db:reconcile-one-c-temporary -- --target=production --apply'

echo '[5/5] Restarting and checking services'
systemctl restart yu-inventory yu-inventory-push-worker
systemctl is-active --quiet yu-inventory
systemctl is-active --quiet yu-inventory-push-worker
echo 'Update complete. Open /integrations/1c and review the temporary cards.'

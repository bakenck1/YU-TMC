#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo 'Run this script with sudo bash.' >&2
  exit 1
fi

cd /opt/yu-inventory/current
test -z "$(sudo -u yu-inventory git status --porcelain)"
systemctl start yu-inventory-backup.service
test "$(systemctl show yu-inventory-backup.service -p Result --value)" = success
test "$(systemctl show yu-inventory-backup.service -p ExecMainStatus --value)" = 0
systemctl stop yu-inventory yu-inventory-push-worker

# systemd reads the existing protected environment without copying its secrets.
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

systemctl restart yu-inventory yu-inventory-push-worker
systemctl is-active --quiet yu-inventory
systemctl is-active --quiet yu-inventory-push-worker
echo 'Update complete. Open /integrations/1c and review the temporary cards.'

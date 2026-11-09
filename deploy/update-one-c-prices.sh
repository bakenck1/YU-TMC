#!/usr/bin/env bash
set -Eeuo pipefail
trap 'printf "Update failed at line %s. Check the error and service status before retrying.\n" "$LINENO" >&2' ERR

if [[ "${EUID}" -ne 0 ]]; then
  echo 'Run this script with sudo bash.' >&2
  exit 1
fi

cd /opt/yu-inventory/current
echo '[1/6] Checking the deployed source'
sudo -u yu-inventory git log -1 --format='%h %s'
if [[ -n "$(sudo -u yu-inventory git status --porcelain)" ]]; then
  echo 'Preserve and resolve local checkout changes before updating.' >&2
  sudo -u yu-inventory git status --short
  exit 1
fi

echo '[2/6] Creating and checking the database backup'
systemctl start yu-inventory-backup.service
test "$(systemctl show yu-inventory-backup.service -p Result --value)" = success
test "$(systemctl show yu-inventory-backup.service -p ExecMainStatus --value)" = 0

echo '[3/6] Preparing the runtime environment and stopping services'
node deploy/prepare-runtime-env.mjs /etc/yu-inventory/yu-inventory.env /etc/yu-inventory/yu-inventory-runtime.env
install -o yu-inventory -g yu-inventory -m 600 /etc/yu-inventory/yu-inventory-runtime.env .env.production.local
systemctl stop yu-inventory yu-inventory-push-worker

echo '[4/6] Installing dependencies, checking the database and building'
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
    mkdir -p .next/cache'

echo '[5/6] Restarting services'
systemctl restart yu-inventory yu-inventory-push-worker
systemctl is-active --quiet yu-inventory
systemctl is-active --quiet yu-inventory-push-worker

echo '[6/6] Checking the pricing contract of both APIs'
for service in fixed-assets materials; do
  curl --fail --silent --show-error --max-time 15 --retry 10 --retry-delay 1 \
    --retry-connrefused --retry-max-time 30 \
    "http://127.0.0.1:3000/api/integrations/1c/${service}" \
    | node -e '
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", chunk => input += chunk);
      process.stdin.on("end", () => {
        const result = JSON.parse(input);
        const field = process.argv[1] === "fixed-assets" ? "InitialCost" : "UnitPrice";
        if (!result.configured || result.pricing?.field !== field || result.pricing?.minimum !== 0) {
          console.error("API pricing contract or integration key is not configured: " + process.argv[1]);
          process.exitCode = 1;
        } else console.log(process.argv[1] + ": configured; " + field + " accepts zero and positive values");
      });' "$service"
done

sudo -u yu-inventory git log -1 --format='Installed commit: %h %cI %s'
echo 'Update complete. Request the full 1C exports, then review and apply card prices at /integrations/1c.'

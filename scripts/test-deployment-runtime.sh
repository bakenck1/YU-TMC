#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "The isolated deployment smoke test must run as root." >&2
  exit 1
fi

readonly workspace_directory="${GITHUB_WORKSPACE:-$PWD}"
for required_command in node openssl flock; do
  command -v "$required_command" >/dev/null 2>&1 || {
    echo "Required command is missing: $required_command" >&2
    exit 1
  }
done

readonly test_root=/tmp/yu-inventory-deployment-test
readonly fake_bin="$test_root/bin"
readonly certificate_source="$test_root/certificates"
rm -rf -- "$test_root"
mkdir -p -- "$fake_bin" "$certificate_source"

fail() {
  echo "Deployment runtime smoke test failed: $*" >&2
  exit 1
}

[[ -f "$workspace_directory/deploy/backup-postgres.sh" ]] ||
  fail "the repository workspace is unavailable: $workspace_directory"

assert_file() {
  [[ -f "$1" ]] || fail "expected file: $1"
}

assert_no_temporary_files() {
  [[ -z "$(find "$1" -maxdepth 1 \( -type f -o -type d \) \( -name '.yu-inventory-*' -o -name '.source.*' -o -name '.rollback.*' -o -name '.nginx-config.*' \) -print -quit)" ]] ||
    fail "temporary deployment file was left behind in $1"
}

cat >"$fake_bin/psql" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
readonly state_directory=/tmp/yu-inventory-deployment-test
printf '%s\n' "$*" >>"$state_directory/psql.log"
if [[ -n "${PGPASSFILE:-}" ]]; then
  printf 'PGPASSFILE=%s\n' "$PGPASSFILE" >>"$state_directory/psql.log"
  cat "$PGPASSFILE" >>"$state_directory/psql.log"
fi
cat "$state_directory/deployment-id"
EOF
cat >"$fake_bin/pg_dump" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
readonly state_directory=/tmp/yu-inventory-deployment-test
backup_file=""
for argument in "$@"; do
  if [[ "$argument" == --file=* ]]; then
    backup_file="${argument#--file=}"
  fi
done
[[ -n "$backup_file" ]] || exit 2
printf 'fake custom-format dump\n' >"$backup_file"
printf '%s\n' "$*" >>"$state_directory/pg-dump.log"
if [[ -n "${PGPASSFILE:-}" ]]; then
  printf 'PGPASSFILE=%s\n' "$PGPASSFILE" >>"$state_directory/pg-dump.log"
fi
EOF
cat >"$fake_bin/pg_restore" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ "${1:-}" == --list && -s "${2:-}" ]] || exit 2
EOF
cat >"$fake_bin/nginx" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
readonly state_directory=/tmp/yu-inventory-deployment-test
case "${1:-}" in
  -T) cat "$state_directory/nginx-dump" ;;
  -t)
    if [[ -e "$state_directory/nginx-test-fails" ]]; then
      exit 1
    fi
    ;;
  *) exit 2 ;;
esac
EOF
cat >"$fake_bin/systemctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>/tmp/yu-inventory-deployment-test/systemctl.log
EOF
chmod 0755 "$fake_bin"/*
export PATH="$fake_bin:$PATH"

install -d -o root -g root -m 0700 /etc/yu-inventory /var/backups/yu-inventory
install -d -o root -g root -m 0755 /usr/local/libexec /usr/local/sbin
install -o root -g root -m 0750 \
  "$workspace_directory/deploy/backup-postgres.sh" \
  /usr/local/sbin/yu-inventory-backup
install -o root -g root -m 0750 \
  "$workspace_directory/deploy/backup-postgres-connection.mjs" \
  /usr/local/libexec/yu-inventory-backup-connection.mjs
cat >/etc/yu-inventory/yu-inventory.env <<'EOF'
DATABASE_URL=postgresql://runtime:runtime-password@db-replica/yu_inventory
DATABASE_MIGRATOR_URL=postgresql://migrator:migrator-password@db-primary/yu_inventory
DATABASE_DEPLOYMENT_ID=deployment-test
DATABASE_SSL_MODE=require
DATABASE_ALLOW_UNVERIFIED_TLS=true
UNTRUSTED_VALUE=$(touch /tmp/yu-inventory-deployment-test/source-sentinel)
EOF
chown root:root /etc/yu-inventory/yu-inventory.env
chmod 0600 /etc/yu-inventory/yu-inventory.env
printf 'deployment-test\n' >"$test_root/deployment-id"
printf 'old backup\n' >/var/backups/yu-inventory/yu-inventory-old.dump
touch -d '31 days ago' /var/backups/yu-inventory/yu-inventory-old.dump
printf 'keep this unrelated file\n' >/var/backups/yu-inventory/keep-me.dump
touch -d '31 days ago' /var/backups/yu-inventory/keep-me.dump

/usr/local/sbin/yu-inventory-backup >"$test_root/backup-success.log"
new_backup_count="$(find /var/backups/yu-inventory -maxdepth 1 -type f -name 'yu-inventory-*.dump' | wc -l)"
[[ "$new_backup_count" -eq 1 ]] || fail "successful backup did not publish exactly one current dump"
new_backup="$(find /var/backups/yu-inventory -maxdepth 1 -type f -name 'yu-inventory-*.dump' -print -quit)"
assert_file "$new_backup"
[[ "$(stat -c '%a' "$new_backup")" == 600 ]] || fail "published backup is not mode 0600"
[[ ! -e /var/backups/yu-inventory/yu-inventory-old.dump ]] || fail "matching old backup was not retained by policy"
assert_file /var/backups/yu-inventory/keep-me.dump
grep -F 'postgresql://migrator@db-primary/yu_inventory' "$test_root/psql.log" >/dev/null
grep -F 'postgresql://runtime@db-replica/yu_inventory' "$test_root/psql.log" >/dev/null
grep -F 'migrator:migrator-password' "$test_root/psql.log" >/dev/null
grep -F 'runtime:runtime-password' "$test_root/psql.log" >/dev/null
[[ ! -e "$test_root/source-sentinel" ]] || fail "environment file was executed as shell code"
assert_no_temporary_files /var/backups/yu-inventory

backup_list_before="$(find /var/backups/yu-inventory -maxdepth 1 -type f -name '*.dump' -printf '%f\n' | sort)"
printf 'wrong-deployment\n' >"$test_root/deployment-id"
if /usr/local/sbin/yu-inventory-backup >"$test_root/backup-mismatch.log" 2>&1; then
  fail "schema deployment mismatch was accepted"
fi
backup_list_after="$(find /var/backups/yu-inventory -maxdepth 1 -type f -name '*.dump' -printf '%f\n' | sort)"
[[ "$backup_list_before" == "$backup_list_after" ]] || fail "mismatch changed published backups"
assert_no_temporary_files /var/backups/yu-inventory
printf 'deployment-test\n' >"$test_root/deployment-id"

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$test_root/root.key" \
  -out "$test_root/root.pem" \
  -subj '/CN=YU Inventory Test Root' -days 30 >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes \
  -keyout "$certificate_source/privkey.pem" \
  -out "$test_root/leaf.csr" \
  -subj '/CN=inventory.yu.edu.kz' >/dev/null 2>&1
cat >"$test_root/cert-ext.cnf" <<'EOF'
[v3_req]
subjectAltName=DNS:inventory.yu.edu.kz
EOF
openssl x509 -req \
  -in "$test_root/leaf.csr" \
  -CA "$test_root/root.pem" \
  -CAkey "$test_root/root.key" \
  -CAcreateserial \
  -out "$certificate_source/cert.pem" \
  -days 30 \
  -extfile "$test_root/cert-ext.cnf" \
  -extensions v3_req >/dev/null 2>&1
install -o root -g root -m 0600 "$test_root/root.pem" "$certificate_source/chain.pem"
cat "$certificate_source/cert.pem" "$certificate_source/chain.pem" >"$certificate_source/fullchain.pem"
chown root:root "$certificate_source"/*
chmod 0600 "$certificate_source"/*
rm -f -- "$test_root/root.key" "$test_root/root.pem" "$test_root/leaf.csr" \
  "$test_root/cert-ext.cnf" "$test_root/root.srl"

install -o root -g root -m 0600 \
  "$workspace_directory/deploy/nginx/yu-inventory.conf" \
  /etc/yu-inventory/yu-inventory.conf
printf '# configuration file /etc/nginx/nginx.conf:\n' >"$test_root/nginx-dump"
"$workspace_directory/deploy/enable-https.sh" "$certificate_source" >"$test_root/https-success.log"
cat "$certificate_source/cert.pem" "$certificate_source/chain.pem" >"$test_root/expected-fullchain.pem"
cmp -s /etc/ssl/yu-inventory/fullchain.pem "$test_root/expected-fullchain.pem" ||
  fail "installed fullchain was not constructed from the validated chain"
assert_file /etc/ssl/yu-inventory/privkey.pem
[[ -L /etc/nginx/sites-enabled/yu-inventory.conf ]] || fail "Nginx site was not enabled"
[[ "$(readlink /etc/nginx/sites-enabled/yu-inventory.conf)" == /etc/nginx/sites-available/yu-inventory.conf ]] ||
  fail "Nginx site link points outside the trusted available config"
cmp -s /etc/yu-inventory/yu-inventory.conf /etc/nginx/sites-available/yu-inventory.conf ||
  fail "Nginx did not install the trusted config"
grep -F 'reload nginx' "$test_root/systemctl.log" >/dev/null
assert_no_temporary_files /etc/ssl/yu-inventory

cat >"$test_root/nginx-dump" <<'EOF'
# configuration file /etc/nginx/sites-enabled/other.conf:
server {
  listen 80 default_server;
}
EOF
if "$workspace_directory/deploy/enable-https.sh" "$certificate_source" >"$test_root/https-conflict.log" 2>&1; then
  fail "Nginx default-listener conflict was accepted"
fi
cmp -s /etc/ssl/yu-inventory/fullchain.pem "$test_root/expected-fullchain.pem" ||
  fail "default-listener preflight changed the active certificate"
assert_no_temporary_files /etc/ssl/yu-inventory

printf 'old fullchain\n' >/etc/ssl/yu-inventory/fullchain.pem
printf 'old private key\n' >/etc/ssl/yu-inventory/privkey.pem
printf 'old available config\n' >/etc/nginx/sites-available/yu-inventory.conf
rm -f -- /etc/nginx/sites-enabled/yu-inventory.conf
ln -s /etc/nginx/sites-available/yu-inventory.conf /etc/nginx/sites-enabled/yu-inventory.conf
touch "$test_root/nginx-test-fails"
printf '# configuration file /etc/nginx/nginx.conf:\n' >"$test_root/nginx-dump"
if "$workspace_directory/deploy/enable-https.sh" "$certificate_source" >"$test_root/https-rollback.log" 2>&1; then
  fail "Nginx reload failure was accepted"
fi
grep -F 'old fullchain' /etc/ssl/yu-inventory/fullchain.pem >/dev/null
grep -F 'old private key' /etc/ssl/yu-inventory/privkey.pem >/dev/null
grep -F 'old available config' /etc/nginx/sites-available/yu-inventory.conf >/dev/null
[[ -L /etc/nginx/sites-enabled/yu-inventory.conf ]] || fail "rollback did not restore the enabled site link"
[[ "$(readlink /etc/nginx/sites-enabled/yu-inventory.conf)" == /etc/nginx/sites-available/yu-inventory.conf ]] ||
  fail "rollback restored an unexpected site link"
assert_no_temporary_files /etc/ssl/yu-inventory

echo "Isolated deployment smoke tests passed."

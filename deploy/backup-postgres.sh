#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly backup_directory=/var/backups/yu-inventory
readonly expected_backup_directory=/var/backups/yu-inventory
readonly environment_file=/etc/yu-inventory/yu-inventory.env
readonly connection_helper=/usr/local/libexec/yu-inventory-backup-connection.mjs
readonly lock_file=/run/lock/yu-inventory-backup.lock

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this command through sudo." >&2
  exit 1
fi

exec 9>"$lock_file"
if ! flock -n 9; then
  echo "Another PostgreSQL backup is already running." >&2
  exit 1
fi

resolved_backup_directory="$(realpath -e "$backup_directory")"
if [[ "$resolved_backup_directory" != "$expected_backup_directory" ]]; then
  echo "Unexpected backup directory: $resolved_backup_directory" >&2
  exit 1
fi

if [[ "$(stat -c '%u:%a' "$backup_directory")" != "0:700" ]]; then
  echo "Backup directory must be owned by root with mode 0700." >&2
  exit 1
fi

if [[ ! -f "$environment_file" || -L "$environment_file" || "$(stat -c '%u:%a' "$environment_file")" != "0:600" ]]; then
  echo "Environment file must be a root-owned regular file with mode 0600." >&2
  exit 1
fi
if [[ ! -f "$connection_helper" || -L "$connection_helper" ]]; then
  echo "Backup connection helper must be a regular non-symlink file: $connection_helper" >&2
  exit 1
fi
if [[ "$(stat -c '%u' "$connection_helper")" != "0" ]]; then
  echo "Backup connection helper must be owned by root." >&2
  exit 1
fi
case "$(stat -c '%a' "$connection_helper")" in
  *[2367][0-7]|*[0-7][2367])
    echo "Backup connection helper must not be group- or world-writable." >&2
    exit 1
    ;;
esac

runtime_database_url=""
migrator_database_url=""
deployment_id=""
configured_ssl_mode=""
database_ca=""
allow_unverified_tls=""
while IFS= read -r environment_line || [[ -n "$environment_line" ]]; do
  environment_line="${environment_line%$'\r'}"
  if [[ "$environment_line" =~ ^[[:space:]]*$ || "$environment_line" =~ ^[[:space:]]*# ]]; then
    continue
  fi
  if [[ ! "$environment_line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=(.*)$ ]]; then
    echo "Environment file contains an invalid assignment." >&2
    exit 1
  fi
  environment_key="${BASH_REMATCH[2]}"
  environment_value="${BASH_REMATCH[3]}"
  environment_value="${environment_value#"${environment_value%%[![:space:]]*}"}"
  environment_value="${environment_value%"${environment_value##*[![:space:]]}"}"
  if [[ "$environment_value" == \"*\" ]]; then
    if [[ "$environment_value" != *\" ]]; then
      echo "Environment file contains an unterminated quoted value." >&2
      exit 1
    fi
    environment_value="${environment_value:1:${#environment_value}-2}"
  elif [[ "$environment_value" == \'*\' ]]; then
    if [[ "$environment_value" != *\' ]]; then
      echo "Environment file contains an unterminated quoted value." >&2
      exit 1
    fi
    environment_value="${environment_value:1:${#environment_value}-2}"
  fi
  case "$environment_key" in
    DATABASE_URL) runtime_database_url="$environment_value" ;;
    DATABASE_MIGRATOR_URL) migrator_database_url="$environment_value" ;;
    DATABASE_DEPLOYMENT_ID) deployment_id="$environment_value" ;;
    DATABASE_SSL_MODE) configured_ssl_mode="$environment_value" ;;
    DATABASE_SSL_CA) database_ca="$environment_value" ;;
    DATABASE_ALLOW_UNVERIFIED_TLS) allow_unverified_tls="$environment_value" ;;
  esac
done <"$environment_file"

if [[ -z "$migrator_database_url" ]]; then
  echo "DATABASE_MIGRATOR_URL is required." >&2
  exit 1
fi
if [[ -z "$runtime_database_url" ]]; then
  echo "DATABASE_URL is required." >&2
  exit 1
fi
if [[ -z "$deployment_id" ]]; then
  echo "DATABASE_DEPLOYMENT_ID is required." >&2
  exit 1
fi

readonly database_ssl_mode="${configured_ssl_mode:-verify-full}"
case "$database_ssl_mode" in
  verify-full) ;;
  require)
    if [[ "$allow_unverified_tls" != "true" ]]; then
      echo "Unverified database TLS requires DATABASE_ALLOW_UNVERIFIED_TLS=true." >&2
      exit 1
    fi
    ;;
  *)
    echo "Production database backups require verify-full TLS (or an explicitly allowed require mode)." >&2
    exit 1
    ;;
esac

temporary_ca=""
temporary_backup=""
temporary_pgpass=""
temporary_connection=""
temporary_runtime_connection=""
temporary_url=""
temporary_runtime_url=""
cleanup() {
  rm -f -- \
    "$temporary_backup" "$temporary_ca" "$temporary_pgpass" \
    "$temporary_connection" "$temporary_runtime_connection" \
    "$temporary_url" "$temporary_runtime_url"
}
trap cleanup EXIT

if [[ -n "$database_ca" ]]; then
  temporary_ca="$(mktemp "$backup_directory/.yu-inventory-ca.XXXXXX.pem")"
  printf '%b' "$database_ca" >"$temporary_ca"
  openssl x509 -in "$temporary_ca" -noout
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
temporary_pgpass="$(mktemp "$backup_directory/.yu-inventory-pgpass.XXXXXX")"
temporary_connection="$(mktemp "$backup_directory/.yu-inventory-connection.XXXXXX")"
temporary_runtime_connection="$(mktemp "$backup_directory/.yu-inventory-runtime-connection.XXXXXX")"
temporary_url="$(mktemp "$backup_directory/.yu-inventory-url.XXXXXX")"
temporary_runtime_url="$(mktemp "$backup_directory/.yu-inventory-runtime-url.XXXXXX")"
printf '%s' "$migrator_database_url" >"$temporary_url"
printf '%s' "$runtime_database_url" >"$temporary_runtime_url"
unset DATABASE_URL DATABASE_MIGRATOR_URL DATABASE_SSL_CA DATABASE_DEPLOYMENT_ID DATABASE_SSL_MODE DATABASE_ALLOW_UNVERIFIED_TLS

env -i \
  PATH="$PATH" \
  YU_DATABASE_FILE="$temporary_url" \
  YU_RUNTIME_DATABASE_FILE="$temporary_runtime_url" \
  YU_PGPASS_FILE="$temporary_pgpass" \
  YU_CONNECTION_FILE="$temporary_connection" \
  YU_RUNTIME_CONNECTION_FILE="$temporary_runtime_connection" \
  node "$connection_helper"

database_url_without_password="$(sed -n '1p' "$temporary_connection")"
database_password_available="$(sed -n '2p' "$temporary_connection")"
runtime_database_url_without_password="$(sed -n '1p' "$temporary_runtime_connection")"
runtime_database_password_available="$(sed -n '2p' "$temporary_runtime_connection")"
temporary_backup="$(mktemp "$backup_directory/.yu-inventory-${timestamp}.XXXXXX.dump")"
final_backup="$backup_directory/yu-inventory-${timestamp}.dump"

schema_contract_query='select deployment_id from "yu_inventory"."__schema_contract" where singleton = true'
read_schema_contract_deployment_id() {
  local connection_url="$1"
  local password_available="$2"
  local psql_args=(
    --no-psqlrc
    --no-password
    --tuples-only
    --no-align
    --quiet
    --set=ON_ERROR_STOP=1
    --command="$schema_contract_query"
    --dbname="$connection_url"
  )
  if [[ -n "$temporary_ca" && "$password_available" == "1" ]]; then
    env -i PATH="$PATH" PGSSLMODE="$database_ssl_mode" PGSSLROOTCERT="$temporary_ca" PGPASSFILE="$temporary_pgpass" \
      psql "${psql_args[@]}"
  elif [[ -n "$temporary_ca" ]]; then
    env -i PATH="$PATH" PGSSLMODE="$database_ssl_mode" PGSSLROOTCERT="$temporary_ca" psql "${psql_args[@]}"
  elif [[ "$password_available" == "1" ]]; then
    env -i PATH="$PATH" PGSSLMODE="$database_ssl_mode" PGPASSFILE="$temporary_pgpass" psql "${psql_args[@]}"
  else
    env -i PATH="$PATH" PGSSLMODE="$database_ssl_mode" psql "${psql_args[@]}"
  fi
}

migrator_deployment_id="$(read_schema_contract_deployment_id "$database_url_without_password" "$database_password_available")"
runtime_deployment_id="$(read_schema_contract_deployment_id "$runtime_database_url_without_password" "$runtime_database_password_available")"
if [[ -z "$migrator_deployment_id" || "$migrator_deployment_id" != "$deployment_id" || "$runtime_deployment_id" != "$deployment_id" ]]; then
  echo "Database schema contract does not match DATABASE_DEPLOYMENT_ID." >&2
  exit 1
fi

pg_dump_args=(
  --dbname="$database_url_without_password"
  --format=custom
  --no-password
  --no-owner
  --no-privileges
  --file="$temporary_backup"
)
if [[ -n "$temporary_ca" && "$database_password_available" == "1" ]]; then
  env -i PATH="$PATH" PGSSLMODE="$database_ssl_mode" PGSSLROOTCERT="$temporary_ca" PGPASSFILE="$temporary_pgpass" pg_dump "${pg_dump_args[@]}"
elif [[ -n "$temporary_ca" ]]; then
  env -i PATH="$PATH" PGSSLMODE="$database_ssl_mode" PGSSLROOTCERT="$temporary_ca" pg_dump "${pg_dump_args[@]}"
elif [[ "$database_password_available" == "1" ]]; then
  env -i PATH="$PATH" PGSSLMODE="$database_ssl_mode" PGPASSFILE="$temporary_pgpass" pg_dump "${pg_dump_args[@]}"
else
  env -i PATH="$PATH" PGSSLMODE="$database_ssl_mode" pg_dump "${pg_dump_args[@]}"
fi

env -i PATH="$PATH" pg_restore --list "$temporary_backup" >/dev/null
chmod 0600 "$temporary_backup"
mv -- "$temporary_backup" "$final_backup"
temporary_backup=""

find "$backup_directory" -maxdepth 1 -type f \
  -name 'yu-inventory-*.dump' -mtime +30 -delete

echo "Verified PostgreSQL backup created: $final_backup"

#!/bin/sh
# CI only: run inside the disposable PostgreSQL service, after migrations.
set -eu
test "${POSTGRES_DB:-}" = yu_inventory_test
test "${POSTGRES_USER:-}" = postgres
export PGPASSWORD="$POSTGRES_PASSWORD"
work="$(mktemp -d /tmp/yu-backup-roundtrip.XXXXXX)"
restore_database=yu_inventory_restore_test
cleanup() {
  dropdb -U postgres --if-exists "$restore_database"
  psql -X -U postgres -d yu_inventory_test -v ON_ERROR_STOP=1 -c 'DROP SCHEMA IF EXISTS backup_probe CASCADE' >/dev/null
  rm -f "$work/complete.dump" "$work/truncated.dump"
  rmdir "$work"
}
trap cleanup EXIT

createdb -U postgres "$restore_database"
psql -X -U postgres -d yu_inventory_test -v ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA backup_probe;
CREATE TABLE backup_probe.records (id integer PRIMARY KEY, label text, photo bytea);
INSERT INTO backup_probe.records
SELECT n, 'Сохранность данных ' || n, decode(repeat(md5(n::text), 64), 'hex')
FROM generate_series(1, 128) n;
SQL

# Include the real migrated application schema, not only the probe table.
pg_dump -U postgres -d yu_inventory_test --format=custom --compress=0 --no-owner --no-privileges --file="$work/complete.dump"
pg_restore --list "$work/complete.dump" >/dev/null
pg_restore --file=/dev/null "$work/complete.dump"
pg_restore -U postgres --exit-on-error --no-owner --no-privileges --dbname="$restore_database" "$work/complete.dump"
source_rows="$(psql -X -U postgres -d yu_inventory_test -At -c 'SELECT id, label, md5(photo) FROM backup_probe.records ORDER BY id')"
restored_rows="$(psql -X -U postgres -d "$restore_database" -At -c 'SELECT id, label, md5(photo) FROM backup_probe.records ORDER BY id')"
test "$source_rows" = "$restored_rows"
source_settings="$(psql -X -U postgres -d yu_inventory_test -At -c 'SELECT row_to_json(s) FROM yu_inventory.settings s ORDER BY id')"
restored_settings="$(psql -X -U postgres -d "$restore_database" -At -c 'SELECT row_to_json(s) FROM yu_inventory.settings s ORDER BY id')"
test -n "$source_settings"
test "$source_settings" = "$restored_settings"

# A truncated archive can retain a valid TOC. The full read must reject it.
cp "$work/complete.dump" "$work/truncated.dump"
size="$(wc -c <"$work/truncated.dump")"
truncate -s "$((size - 2048))" "$work/truncated.dump"
pg_restore --list "$work/truncated.dump" >/dev/null
if pg_restore --file=/dev/null "$work/truncated.dump"; then
  echo 'Truncated archive was incorrectly accepted.' >&2
  exit 1
fi
echo 'Real PostgreSQL backup/restore preserved records, binary data and settings; truncated payload rejected.'

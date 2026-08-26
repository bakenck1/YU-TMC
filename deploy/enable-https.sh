#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly domain=inventory.yu.edu.kz
readonly source_certificate_directory="${1:-/secure/path/certs/yu.edu.kz}"
readonly installed_certificate_directory=/etc/ssl/yu-inventory
readonly trusted_nginx_config=/etc/yu-inventory/yu-inventory.conf
readonly nginx_available_config=/etc/nginx/sites-available/yu-inventory.conf
readonly nginx_enabled_config=/etc/nginx/sites-enabled/yu-inventory.conf
readonly lock_file=/run/lock/yu-inventory-enable-https.lock

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this command through sudo." >&2
  exit 1
fi

exec 9>"$lock_file"
if ! flock -n 9; then
  echo "Another HTTPS certificate installation is already running." >&2
  exit 1
fi

if [[ ! -d "$source_certificate_directory" || -L "$source_certificate_directory" ]]; then
  echo "Certificate source directory must be a real directory: $source_certificate_directory" >&2
  exit 1
fi
if [[ "$(stat -c '%u' "$source_certificate_directory")" != "0" ]]; then
  echo "Certificate source directory must be owned by root." >&2
  exit 1
fi
case "$(stat -c '%a' "$source_certificate_directory")" in
  *[2367][0-7]|*[0-7][2367])
    echo "Certificate source directory must not be group- or world-writable." >&2
    exit 1
    ;;
esac

if [[ -L "$installed_certificate_directory" ]]; then
  echo "Certificate destination must be a real directory: $installed_certificate_directory" >&2
  exit 1
fi
if [[ -e "$installed_certificate_directory" && ! -d "$installed_certificate_directory" ]]; then
  echo "Certificate destination must be a real directory: $installed_certificate_directory" >&2
  exit 1
fi
install -d -o root -g root -m 0700 "$installed_certificate_directory"
if [[ "$(realpath -e "$installed_certificate_directory")" != "$installed_certificate_directory" ]]; then
  echo "Certificate destination resolved outside the expected directory." >&2
  exit 1
fi
source_snapshot_directory="$(mktemp -d "$installed_certificate_directory/.source.XXXXXX")"
trusted_nginx_config_snapshot=""
cleanup_source_snapshot() {
  if [[ -z "$source_snapshot_directory" ]]; then
    return
  fi
  rm -f -- \
    "$source_snapshot_directory/cert.pem" \
    "$source_snapshot_directory/chain.pem" \
    "$source_snapshot_directory/fullchain.pem" \
    "$source_snapshot_directory/privkey.pem" \
    "$source_snapshot_directory/validated-fullchain.pem"
  rmdir -- "$source_snapshot_directory"
  source_snapshot_directory=""
  if [[ -n "$trusted_nginx_config_snapshot" ]]; then
    rm -f -- "$trusted_nginx_config_snapshot"
    trusted_nginx_config_snapshot=""
  fi
}
trap cleanup_source_snapshot EXIT

for certificate_name in cert.pem chain.pem fullchain.pem privkey.pem; do
  source_file="$source_certificate_directory/$certificate_name"
  if [[ ! -f "$source_file" || -L "$source_file" ]]; then
    echo "Certificate file must be a regular non-symlink file: $source_file" >&2
    exit 1
  fi
  if [[ "$(stat -c '%u' "$source_file")" != "0" ]]; then
    echo "Certificate file must be owned by root: $source_file" >&2
    exit 1
  fi
  case "$(stat -c '%a' "$source_file")" in
    *[2367][0-7]|*[0-7][2367])
      echo "Certificate file must not be group- or world-writable: $source_file" >&2
      exit 1
      ;;
  esac
  if [[ "$certificate_name" == "privkey.pem" ]]; then
    case "$(stat -c '%a' "$source_file")" in
      400|600) ;;
      *)
        echo "Private key must use mode 0400 or 0600: $source_file" >&2
        exit 1
        ;;
    esac
  fi
  install -o root -g root -m 0600 "$source_file" \
    "$source_snapshot_directory/$certificate_name"
done

certificate="$source_snapshot_directory/cert.pem"
chain="$source_snapshot_directory/chain.pem"
fullchain="$source_snapshot_directory/fullchain.pem"
private_key="$source_snapshot_directory/privkey.pem"

openssl x509 -in "$certificate" -checkend 0 -noout
openssl x509 -in "$certificate" -checkhost "$domain" -noout
openssl verify -purpose sslserver -CAfile "$chain" "$certificate"

certificate_der_hash="$(
  openssl x509 -in "$certificate" -outform DER |
    sha256sum | cut -d' ' -f1
)"
fullchain_der_hash="$(
  openssl x509 -in "$fullchain" -outform DER |
    sha256sum | cut -d' ' -f1
)"
if [[ -z "$certificate_der_hash" || "$certificate_der_hash" != "$fullchain_der_hash" ]]; then
  echo "The first certificate in fullchain.pem does not match cert.pem." >&2
  exit 1
fi

YU_CERTIFICATE_FILE="$certificate" \
YU_CHAIN_FILE="$chain" \
YU_FULLCHAIN_FILE="$fullchain" \
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";

const readCertificates = (file) => {
  const source = readFileSync(file, "utf8");
  const matches = [...source.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)];
  if (matches.length === 0) throw new Error(`No certificates found in ${file}.`);
  return matches.map((match) => new X509Certificate(match[0]));
};
const sameCertificate = (left, right) =>
  Buffer.from(left.raw).equals(Buffer.from(right.raw));
const assertOrder = (certificates, label) => {
  for (let index = 1; index < certificates.length; index += 1) {
    if (certificates[index - 1].issuer !== certificates[index].subject) {
      throw new Error(`${label} is not ordered from leaf issuer to root.`);
    }
  }
};

const [leaf] = readCertificates(process.env.YU_CERTIFICATE_FILE);
const configuredChain = readCertificates(process.env.YU_CHAIN_FILE);
const presentedChain = readCertificates(process.env.YU_FULLCHAIN_FILE);
if (presentedChain.length < 2 || !sameCertificate(leaf, presentedChain[0])) {
  throw new Error("fullchain.pem must contain cert.pem followed by its issuer chain.");
}
assertOrder(configuredChain, "chain.pem");
assertOrder(presentedChain, "fullchain.pem");
const presentedIssuers = presentedChain.slice(1);
if (
  presentedIssuers.length > configuredChain.length ||
  !presentedIssuers.every((certificate, index) =>
    sameCertificate(certificate, configuredChain[index]),
  )
) {
  throw new Error("fullchain.pem does not match the configured issuer chain.");
}
for (const certificate of configuredChain) {
  if (
    certificate.subject !== certificate.issuer &&
    !presentedIssuers.some((presented) => sameCertificate(presented, certificate))
  ) {
    throw new Error("fullchain.pem omits an intermediate certificate.");
  }
}
'

validated_fullchain="$source_snapshot_directory/validated-fullchain.pem"
cat "$certificate" "$chain" >"$validated_fullchain"
chmod 0600 "$validated_fullchain"

public_key_hash_from_certificate() {
  openssl x509 -in "$1" -pubkey -noout |
    openssl pkey -pubin -outform DER 2>/dev/null |
    sha256sum | cut -d' ' -f1
}

certificate_hash="$(public_key_hash_from_certificate "$certificate")"
fullchain_hash="$(public_key_hash_from_certificate "$fullchain")"
private_key_hash="$(
  openssl pkey -in "$private_key" -pubout -outform DER 2>/dev/null |
    sha256sum | cut -d' ' -f1
)"
if [[ -z "$certificate_hash" || "$certificate_hash" != "$fullchain_hash" || "$certificate_hash" != "$private_key_hash" ]]; then
  echo "The certificate, full chain, and private key do not match." >&2
  exit 1
fi

install -d -o root -g root -m 0755 /etc/nginx/sites-available /etc/nginx/sites-enabled
if [[ ! -f "$trusted_nginx_config" || -L "$trusted_nginx_config" ]]; then
  echo "Trusted Nginx configuration must be a regular non-symlink file: $trusted_nginx_config" >&2
  exit 1
fi
if [[ "$(stat -c '%u' "$trusted_nginx_config")" != "0" ]]; then
  echo "Trusted Nginx configuration must be owned by root." >&2
  exit 1
fi
case "$(stat -c '%a' "$trusted_nginx_config")" in
  *[2367][0-7]|*[0-7][2367])
    echo "Trusted Nginx configuration must not be group- or world-writable." >&2
    exit 1
    ;;
esac
trusted_nginx_config_snapshot="$(mktemp "$installed_certificate_directory/.nginx-config.XXXXXX")"
install -o root -g root -m 0600 "$trusted_nginx_config" "$trusted_nginx_config_snapshot"

nginx_config_dump="$(nginx -T 2>/dev/null)" || {
  echo "The current Nginx configuration is invalid; refusing HTTPS activation." >&2
  exit 1
}
if printf '%s\n' "$nginx_config_dump" | awk \
  -v own_config="$nginx_enabled_config" \
  -v own_available="$nginx_available_config" '
  /^# configuration file / { current = $0; next }
  index(current, own_config) == 0 && index(current, own_available) == 0 &&
    $0 ~ /^[[:space:]]*listen[[:space:]]+(\[::\]:)?(80|443)([[:space:]]|;)/ &&
    $0 ~ /[[:space:]]default_server([[:space:]]|;)/ { found = 1; exit }
  END { exit(found ? 0 : 1) }
'; then
  echo "Another Nginx configuration owns a default port 80/443 listener; disable it before activation." >&2
  exit 1
fi

rollback_directory="$(mktemp -d "$installed_certificate_directory/.rollback.XXXXXX")"
rollback_active=1
old_fullchain=0
old_private_key=0
old_available_config=0
old_enabled_config=0
fullchain_was_absent=1
private_key_was_absent=1
available_config_was_absent=1
enabled_config_was_absent=1
new_fullchain_install_started=0
new_private_key_install_started=0
new_available_config_install_started=0
new_enabled_config_link_started=0

remove_new_path_if_safe() {
  local path="$1"
  local old_path_moved="$2"
  local path_was_absent="$3"
  local new_write_started="$4"
  if [[ "$old_path_moved" -eq 1 ]]; then
    rm -f -- "$path"
  elif [[ "$path_was_absent" -eq 1 && "$new_write_started" -eq 1 ]]; then
    rm -f -- "$path"
  fi
}

restore_previous_state() {
  local exit_code=$?
  set +e
  if [[ "$rollback_active" -eq 1 ]]; then
    remove_new_path_if_safe \
      "$installed_certificate_directory/fullchain.pem" \
      "$old_fullchain" "$fullchain_was_absent" "$new_fullchain_install_started"
    remove_new_path_if_safe \
      "$installed_certificate_directory/privkey.pem" \
      "$old_private_key" "$private_key_was_absent" "$new_private_key_install_started"
    remove_new_path_if_safe \
      "$nginx_available_config" \
      "$old_available_config" "$available_config_was_absent" "$new_available_config_install_started"
    remove_new_path_if_safe \
      "$nginx_enabled_config" \
      "$old_enabled_config" "$enabled_config_was_absent" "$new_enabled_config_link_started"
    if [[ "$old_fullchain" -eq 1 ]]; then
      mv -- "$rollback_directory/fullchain.pem" "$installed_certificate_directory/fullchain.pem"
    fi
    if [[ "$old_private_key" -eq 1 ]]; then
      mv -- "$rollback_directory/privkey.pem" "$installed_certificate_directory/privkey.pem"
    fi
    if [[ "$old_available_config" -eq 1 ]]; then
      mv -- "$rollback_directory/available.conf" "$nginx_available_config"
    fi
    if [[ "$old_enabled_config" -eq 1 ]]; then
      mv -- "$rollback_directory/enabled.conf" "$nginx_enabled_config"
    fi
    if nginx -t; then
      systemctl reload nginx || echo "Warning: restored Nginx configuration could not be reloaded." >&2
    else
      echo "Warning: restored Nginx configuration is not valid; inspect the service before retrying." >&2
    fi
  fi
    rm -f -- \
      "$rollback_directory/fullchain.pem" \
      "$rollback_directory/privkey.pem" \
      "$rollback_directory/available.conf" \
      "$rollback_directory/enabled.conf"
  rmdir -- "$rollback_directory"
  cleanup_source_snapshot
  exit "$exit_code"
}
trap restore_previous_state EXIT

if [[ -e "$installed_certificate_directory/fullchain.pem" || -L "$installed_certificate_directory/fullchain.pem" ]]; then
  fullchain_was_absent=0
  mv -- "$installed_certificate_directory/fullchain.pem" "$rollback_directory/fullchain.pem"
  old_fullchain=1
fi
if [[ -e "$installed_certificate_directory/privkey.pem" || -L "$installed_certificate_directory/privkey.pem" ]]; then
  private_key_was_absent=0
  mv -- "$installed_certificate_directory/privkey.pem" "$rollback_directory/privkey.pem"
  old_private_key=1
fi
if [[ -e "$nginx_available_config" || -L "$nginx_available_config" ]]; then
  available_config_was_absent=0
  mv -- "$nginx_available_config" "$rollback_directory/available.conf"
  old_available_config=1
fi
if [[ -e "$nginx_enabled_config" || -L "$nginx_enabled_config" ]]; then
  enabled_config_was_absent=0
  mv -- "$nginx_enabled_config" "$rollback_directory/enabled.conf"
  old_enabled_config=1
fi

new_fullchain_install_started=1
install -o root -g root -m 0644 "$validated_fullchain" \
  "$installed_certificate_directory/fullchain.pem"
new_private_key_install_started=1
install -o root -g root -m 0600 "$private_key" \
  "$installed_certificate_directory/privkey.pem"
new_available_config_install_started=1
install -o root -g root -m 0644 \
  "$trusted_nginx_config_snapshot" \
  "$nginx_available_config"
new_enabled_config_link_started=1
ln -s "$nginx_available_config" "$nginx_enabled_config"

nginx -t
systemctl reload nginx

rollback_active=0
trap - EXIT
rm -f -- \
  "$rollback_directory/fullchain.pem" \
  "$rollback_directory/privkey.pem" \
  "$rollback_directory/available.conf" \
  "$rollback_directory/enabled.conf"
rmdir -- "$rollback_directory"
cleanup_source_snapshot

echo "Provided certificate installed and HTTPS enabled for https://$domain"

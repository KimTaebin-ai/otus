#!/usr/bin/env bash
# Usage: ./deploy/start-podman.sh [repo-root]
# With deploy/.env: production settings. Without it: the existing local/Vagrant demo.
# Production .env uses literal, single-line KEY=value entries (no shell expansion).
# APP_ORIGIN=https://your-host:8443; DEMO_LOGIN_ENABLED defaults to false.
# Public demo login/seed requires both DEMO_LOGIN_ENABLED=true and
# DEMO_LOGIN_ALLOW_PUBLIC=true; otherwise demo login is disabled on public origins.
# CI sets OTUS_REQUIRE_OAUTH=true to require 42 credentials and disable all demo access.
# In CI, the standard local dev DATABASE_URL uses saved/generated pod credentials
# instead, and the relative dev upload directory becomes /data/uploads.
# An unset APP_ORIGIN uses SITE_ADDRESS, then OTUS_DEPLOY_HOST (EC2_HOST in CI).
# CI also replaces the localhost:4200 Angular development origin with this fallback.
# Bare hostnames use HTTPS/8443; explicit HTTPS URLs retain their public port.
# Admin app (issue #9): ADMIN_SITE_ADDRESS=admin.your-domain (a DNS name, no IP; like APP_ORIGIN a
# bare name means :8443, write https://admin.your-domain for 443) makes Caddy
# serve it there; APP_ORIGINS then defaults to the student and admin origins, and with 42
# credentials FORTY_TWO_ADMIN_REDIRECT_URI defaults to <admin origin>/api/auth/42/callback
# (register it in the 42 app). STAFF_ROLE_ALLOWLIST=login=operator,... grants staff roles.
# Email: MAIL_RECIPIENT_DOMAIN, SMTP_HOST, SMTP_PORT, SMTP_TLS, SMTP_FROM and
# SMTP_USERNAME configure the backend. SMTP_PASSWORD is stored in the backend secret
# and injected through SMTP_PASSWORD_FILE, never as a container environment value.
# Optional secrets: POSTGRES_PASSWORD, OTUS_APP_PASSWORD, DATABASE_URL,
# BANK_ACCOUNT_KEY, FILE_ENCRYPTION_KEY, FORTY_TWO_CLIENT_ID, FORTY_TWO_CLIENT_SECRET.
# Unspecified secrets are kept, or generated on the first deployment. Back up
# deploy/secrets.yaml with the data; DB passwords/encryption keys cannot be rotated here.
# SMTP_PASSWORD can be updated on redeploy; omit it to reuse it, or set it empty to clear it.
# An existing DB role with a stale password is reconciled to the saved app password
# only after authenticating with the saved Postgres administrator password.
set -euo pipefail
umask 077

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

if [ "$#" -gt 1 ]; then
  fail "Usage: $0 [repo-root]"
fi
repo_root=${1:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}
cd -- "$repo_root" || fail "Cannot open repository: $repo_root"
for file in Makefile deploy/otus-pod.yaml deploy/secrets.example.yaml deploy/Caddyfile \
  deploy/db.Containerfile deploy/backend.Containerfile deploy/clamav.Containerfile \
  deploy/web.Containerfile; do
  [ -f "$file" ] || fail "Missing $file. Pass the repository root as the first argument."
done
for command in podman make curl openssl; do
  command -v "$command" >/dev/null 2>&1 || fail "Required command not found: $command"
done

# SSH and Vagrant must use the same rootless storage/runtime as an interactive login.
if [ "$(uname -s)" = Linux ] && [ "$(id -u)" -ne 0 ]; then
  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
  if [ ! -d "$XDG_RUNTIME_DIR" ] || [ ! -O "$XDG_RUNTIME_DIR" ] || [ ! -w "$XDG_RUNTIME_DIR" ]; then
    fail "No usable runtime directory: $XDG_RUNTIME_DIR. Enable linger for the Podman user."
  fi
  if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ] && [ -S "$XDG_RUNTIME_DIR/bus" ]; then
    export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
  fi
fi
podman info >/dev/null || fail "Podman is not ready. Check rootless UID/GID mappings or podman machine."

work_dir=$(mktemp -d)
deploy_started=false
cleanup() {
  result=$?
  trap - EXIT
  if [ "$result" -ne 0 ] && [ "$deploy_started" = true ]; then
    podman ps -a --pod --filter pod=otus >&2 || true
    for container in otus-db otus-backend otus-clamav otus-web; do
      if podman container exists "$container"; then
        printf '\n--- %s ---\n' "$container" >&2
        podman container inspect --format \
          'status={{.State.Status}} exit={{.State.ExitCode}} restarts={{.RestartCount}} oom={{.State.OOMKilled}}' \
          "$container" >&2 || true
        podman logs --tail 60 "$container" >&2 || true
      fi
    done
  fi
  rm -rf -- "$work_dir"
  exit "$result"
}
trap cleanup EXIT

# Never regenerate encryption keys over data left by an earlier deployment.
if [ ! -f deploy/secrets.yaml ]; then
  for volume in otus-pgdata otus-uploads; do
    if podman volume exists "$volume"; then
      fail "Existing $volume has no deploy/secrets.yaml. Restore that file from backup before deploying."
    fi
  done
fi

pod_file=deploy/otus-pod.yaml
health_host=localhost
app_origin=https://localhost:8443
seed_demo=true
if [ -f deploy/.env ]; then
  command -v python3 >/dev/null 2>&1 || fail 'Production deployment requires python3.'
  python3 -c 'import yaml' 2>/dev/null || fail 'Install python3-yaml for production deployment.'
  python3 - "$work_dir" <<'PY'
import base64
import ipaddress
import os
from pathlib import Path
import re
import secrets
import shlex
import sys
from urllib.parse import quote, unquote, urlsplit

import yaml


def fail(message):
    sys.exit(f"ERROR: {message}")


# Parse data instead of sourcing .env: $, backticks and command substitutions stay literal.
env = {}
for number, line in enumerate(Path("deploy/.env").read_text().splitlines(), 1):
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    if line.startswith("export "):
        line = line[7:].lstrip()
    key, separator, value = line.partition("=")
    key, value = key.strip(), value.strip()
    if not separator or not re.fullmatch(r"[A-Z][A-Z0-9_]*", key) or key in env:
        fail(f"Invalid or duplicate .env entry on line {number}.")
    if value.startswith(("'", '"')):
        try:
            parts = shlex.split(value, comments=True)
        except ValueError:
            fail(f"Invalid quoting in .env on line {number}.")
        if len(parts) != 1:
            fail(f"Expected a single value in .env on line {number}.")
        value = parts[0]
    else:
        value = re.split(r"\s+#", value, maxsplit=1)[0].rstrip()
    env[key] = value

secret_keys = {
    "POSTGRES_PASSWORD", "OTUS_APP_PASSWORD", "DATABASE_URL", "BANK_ACCOUNT_KEY",
    "FILE_ENCRYPTION_KEY", "FORTY_TWO_CLIENT_ID", "FORTY_TWO_CLIENT_SECRET",
    "SMTP_PASSWORD",
}
backend_keys = {
    "APP_ORIGIN", "DEMO_LOGIN_ENABLED", "DEMO_LOGIN_ALLOW_PUBLIC",
    "FORTY_TWO_REDIRECT_URI", "FORTY_TWO_CAMPUS_ID", "FORTY_TWO_API_BASE",
    "BANK_ACCOUNT_KEY_ID", "FILE_ENCRYPTION_KEY_ID", "MAX_UPLOAD_BYTES", "RUST_LOG",
    "BIND_ADDR", "UPLOAD_DIR", "CLAMAV_ADDR",
    "APP_ORIGINS", "FORTY_TWO_ADMIN_REDIRECT_URI", "STAFF_ROLE_ALLOWLIST",
    "MAIL_RECIPIENT_DOMAIN", "SMTP_HOST", "SMTP_PORT", "SMTP_TLS", "SMTP_FROM",
    "SMTP_USERNAME",
}
unknown = env.keys() - secret_keys - backend_keys - {"SITE_ADDRESS", "ADMIN_SITE_ADDRESS"}
if unknown:
    fail("Unsupported .env variables: " + ", ".join(sorted(unknown)))

def parse_address(value, name):
    value = value.strip()
    bare_host = "://" not in value
    try:
        url = urlsplit("https://" + value if bare_host else value)
        port = url.port
    except ValueError:
        fail(f"{name} has an invalid hostname or port; use https://your-host:8443.")
    if url.scheme == "http":
        fail(f"{name} uses HTTP, but this deployment serves HTTPS. "
             "Set APP_ORIGIN=https://your-host:8443 in PRODUCTION_ENV "
             "(or your public HTTPS proxy URL).")
    if url.scheme != "https" or not url.hostname:
        fail(f"{name} must contain a hostname or HTTPS URL, e.g. https://your-host:8443.")
    if (url.username is not None or url.password is not None or url.path.strip("/")
            or "?" in value or "#" in value or any(c.isspace() for c in value)):
        fail(f"{name} must contain only scheme, hostname and optional port; "
             "remove credentials, paths, query parameters and fragments.")
    if not re.fullmatch(r"[a-zA-Z0-9.-]+", url.hostname):
        fail(f"{name} must use a DNS hostname or IPv4 address.")
    if port == 0:
        fail(f"{name} must use a port between 1 and 65535.")
    return url.hostname, port if port is not None else (8443 if bare_host else 443)


origin_value = env.get("APP_ORIGIN", "").strip()
origin_source = "APP_ORIGIN"
deploy_host = os.environ.get("OTUS_DEPLOY_HOST", "").strip()
origin_fallback_reason = "APP_ORIGIN is unset"
# backend/.env.example targets the Angular dev server. When CI supplies an EC2
# target, use the deployed browser origin instead of the developer's loopback URL.
if deploy_host and origin_value.lower().rstrip("/") in {
    "http://localhost:4200", "http://127.0.0.1:4200", "http://[::1]:4200",
}:
    origin_value = ""
    origin_fallback_reason = "APP_ORIGIN points to the local Angular development server"
if not origin_value:
    origin_value = env.get("SITE_ADDRESS", "").strip()
    origin_source = "SITE_ADDRESS"
if not origin_value:
    origin_value = deploy_host
    origin_source = "OTUS_DEPLOY_HOST"
if not origin_value:
    fail("APP_ORIGIN is unset. Set APP_ORIGIN=https://your-host:8443 in deploy/.env, "
         "or provide SITE_ADDRESS / OTUS_DEPLOY_HOST.")
host, public_port = parse_address(origin_value, origin_source)
origin = f"https://{host}" + (f":{public_port}" if public_port != 443 else "")
env["APP_ORIGIN"] = origin
if origin_source != "APP_ORIGIN":
    print(f"{origin_fallback_reason}; using {origin_source} for the HTTPS origin.")

site = env.get("SITE_ADDRESS", "").strip()
if site:
    site_host, site_port = parse_address(site, "SITE_ADDRESS")
    if site_host != host or site_port not in (443, 8443):
        fail("SITE_ADDRESS must match the APP_ORIGIN hostname, optionally with HTTPS/port 8443.")
# Caddy's configured listener is always 8443, even when a proxy exposes another port.
site = host

# The admin app's own origin (a subdomain, so its session cookie is separate)
admin_origin = ""
admin_host = ""
admin_value = env.get("ADMIN_SITE_ADDRESS", "").strip()
# A local .env must keep the same admin site as the no-.env Vagrant setup.
# Caddy still serves admin.localhost by default; dropping its origin here would
# make every admin login/send request fail the backend's Origin check.
if not admin_value and origin == "https://localhost:8443":
    admin_value = "https://admin.localhost:8443"
if admin_value:
    admin_host, admin_port = parse_address(admin_value, "ADMIN_SITE_ADDRESS")
    try:
        ipaddress.IPv4Address(admin_host)
    except ipaddress.AddressValueError:
        pass
    else:
        fail("ADMIN_SITE_ADDRESS must be a DNS name (admin.your-domain), not an IP address.")
    if admin_host == host:
        fail("ADMIN_SITE_ADDRESS must differ from the student site's hostname.")
    admin_origin = f"https://{admin_host}" + (f":{admin_port}" if admin_port != 443 else "")
# The backend's Origin check: APP_ORIGINS wins over APP_ORIGIN, so it is always set here and
# can never inherit the local values of deploy/otus-pod.yaml.
origins = [o.strip().rstrip("/") for o in env.get("APP_ORIGINS", "").split(",") if o.strip()]
if not origins:
    origins = [origin] + ([admin_origin] if admin_origin else [])
elif origin not in origins:
    fail("APP_ORIGINS must include APP_ORIGIN (the student origin).")
if admin_origin and admin_origin not in origins:
    fail("APP_ORIGINS must include the admin origin (" + admin_origin + ").")
env["APP_ORIGINS"] = ",".join(origins)

require_oauth = os.environ.get("OTUS_REQUIRE_OAUTH", "false") == "true"
if require_oauth:
    env["DEMO_LOGIN_ENABLED"] = "false"
    env["DEMO_LOGIN_ALLOW_PUBLIC"] = "false"
    print("42 OAuth deployment: demo login and demo seeding are disabled.")
    # The local dev database is published on host port 5433. The production pod
    # connects on 5432 using its own password; never copy the dev password over it.
    # Also recognize the dev URL after only its port has been changed to 5432.
    if env.get("DATABASE_URL") in {
        f"{scheme}://otus:otus_dev@{db_host}:{db_port}/otus"
        for scheme in ("postgres", "postgresql")
        for db_host in ("127.0.0.1", "localhost")
        for db_port in (5432, 5433)
    }:
        del env["DATABASE_URL"]
        print("Local development DATABASE_URL detected; using the pod database on port 5432 "
              "with saved credentials, or generated credentials on first deployment.")
    if env.get("UPLOAD_DIR") in ("./data/uploads", "data/uploads"):
        env["UPLOAD_DIR"] = "/data/uploads"
        print("Local development UPLOAD_DIR detected; using /data/uploads in the pod.")
for key in ("DEMO_LOGIN_ENABLED", "DEMO_LOGIN_ALLOW_PUBLIC"):
    value = env.get(key, "false")
    if value not in ("true", "false", "1", "0"):
        fail(f"{key} must be true or false.")
    env[key] = "true" if value in ("true", "1") else "false"
if (env["DEMO_LOGIN_ENABLED"] == "true" and host not in ("localhost", "127.0.0.1")
        and env["DEMO_LOGIN_ALLOW_PUBLIC"] != "true"):
    env["DEMO_LOGIN_ENABLED"] = "false"
    print("Public demo login was not explicitly allowed; using DEMO_LOGIN_ENABLED=false. "
          "For a public demo, set both DEMO_LOGIN_ENABLED=true and DEMO_LOGIN_ALLOW_PUBLIC=true.")

secret_file = Path("deploy/secrets.yaml")
existing = secret_file.exists()
try:
    if existing:
        documents = list(yaml.safe_load_all(secret_file.read_text()))
        by_name = {doc["metadata"]["name"]: doc["stringData"] for doc in documents}
        db, backend = by_name["otus-db"], by_name["otus-backend"]
    else:
        db = {"postgres-password": secrets.token_hex(24), "app-password": secrets.token_hex(24)}
        backend = {
            "bank-account-key": base64.b64encode(secrets.token_bytes(32)).decode(),
            "file-encryption-key": base64.b64encode(secrets.token_bytes(32)).decode(),
            "forty-two-client-id": "", "forty-two-client-secret": "",
        }
        documents = [
            {"apiVersion": "v1", "kind": "Secret", "metadata": {"name": name},
             "type": "Opaque", "stringData": values}
            for name, values in (("otus-db", db), ("otus-backend", backend))
        ]
except (yaml.YAMLError, KeyError, TypeError):
    fail("Invalid deploy/secrets.yaml; restore the original secrets file.")

if "DATABASE_URL" in env:
    try:
        database = urlsplit(env["DATABASE_URL"])
        valid_database = (database.scheme in ("postgres", "postgresql")
                          and database.hostname in ("localhost", "127.0.0.1")
                          and database.port in (None, 5432) and database.username == "otus"
                          and database.path == "/otus" and database.password
                          and not database.query and not database.fragment)
    except ValueError:
        valid_database = False
    if not valid_database:
        fail("DATABASE_URL must address the pod database: postgres://otus:PASSWORD@127.0.0.1:5432/otus. "
             "Omit DATABASE_URL to use saved credentials, or generate them on first deployment.")
    password = unquote(database.password)
    if "OTUS_APP_PASSWORD" in env and env["OTUS_APP_PASSWORD"] != password:
        fail("DATABASE_URL and OTUS_APP_PASSWORD disagree.")
    env["OTUS_APP_PASSWORD"] = password

for variable, values, key in (
    ("POSTGRES_PASSWORD", db, "postgres-password"),
    ("OTUS_APP_PASSWORD", db, "app-password"),
    ("BANK_ACCOUNT_KEY", backend, "bank-account-key"),
    ("FILE_ENCRYPTION_KEY", backend, "file-encryption-key"),
    ("FORTY_TWO_CLIENT_ID", backend, "forty-two-client-id"),
    ("FORTY_TWO_CLIENT_SECRET", backend, "forty-two-client-secret"),
    ("SMTP_PASSWORD", backend, "smtp-password"),
):
    # Provider credentials are optional and can change without migrating stored data.
    rotatable = variable.startswith("FORTY_TWO_") or variable == "SMTP_PASSWORD"
    if variable in env:
        if existing and not rotatable and env[variable] != values.get(key):
            if variable == "OTUS_APP_PASSWORD":
                fail("DATABASE_URL / OTUS_APP_PASSWORD differs from saved secrets. "
                     "Remove DATABASE_URL and OTUS_APP_PASSWORD from the deployment .env "
                     "to reuse the saved pod password; password rotation requires a separate migration.")
            fail(f"{variable} differs from saved secrets; migrate existing data before rotating it.")
        values[key] = env[variable]
    if not rotatable and (not isinstance(values.get(key), str) or not values[key]
                          or values[key].startswith("CHANGE_ME_")):
        fail(f"Missing or invalid {variable} in saved secrets.")

for key in ("bank-account-key", "file-encryption-key"):
    try:
        if len(base64.b64decode(backend[key], validate=True)) != 32:
            raise ValueError
    except ValueError:
        fail(f"{key} must be a base64-encoded 32-byte key.")
if backend["bank-account-key"] == backend["file-encryption-key"]:
    fail("BANK_ACCOUNT_KEY and FILE_ENCRYPTION_KEY must be different.")
if backend.get("forty-two-client-id") and not backend.get("forty-two-client-secret"):
    fail("FORTY_TWO_CLIENT_SECRET is required with FORTY_TWO_CLIENT_ID.")
if require_oauth:
    if not backend.get("forty-two-client-id"):
        fail("42 OAuth deployment requires FORTY_TWO_CLIENT_ID and FORTY_TWO_CLIENT_SECRET "
             "in PRODUCTION_ENV.")
    callback = env.get("FORTY_TWO_REDIRECT_URI", "").strip()
    expected_callback = origin + "/api/auth/42/callback"
    if not callback or callback == "https://localhost:8443/api/auth/42/callback":
        callback = expected_callback
    if callback != expected_callback:
        fail("FORTY_TWO_REDIRECT_URI must match APP_ORIGIN + /api/auth/42/callback. "
             "Register the same HTTPS URL in the 42 OAuth application.")
    env["FORTY_TWO_REDIRECT_URI"] = callback
if env["DEMO_LOGIN_ENABLED"] == "false" and not backend.get("forty-two-client-id"):
    print("WARNING: Login is unavailable: demo login is disabled and 42 OAuth is not configured. "
          "Set FORTY_TWO_CLIENT_ID, FORTY_TWO_CLIENT_SECRET and FORTY_TWO_REDIRECT_URI "
          "in PRODUCTION_ENV for 42 login.")
backend["database-url"] = f"postgres://otus:{quote(db['app-password'], safe='')}@127.0.0.1:5432/otus"

# Render a private temporary copy; the checked-in manifest remains the local demo template.
pod = yaml.safe_load(Path("deploy/otus-pod.yaml").read_text())
for container in pod["spec"]["containers"]:
    overrides = {}
    if container["name"] == "backend":
        overrides = {key: env[key] for key in backend_keys if key in env}
        if backend.get("smtp-password"):
            overrides["SMTP_PASSWORD_FILE"] = "/run/secrets/otus-backend/smtp-password"
        overrides.setdefault("FORTY_TWO_REDIRECT_URI", origin + "/api/auth/42/callback")
        if admin_origin and backend.get("forty-two-client-id"):
            overrides.setdefault(
                "FORTY_TWO_ADMIN_REDIRECT_URI", admin_origin + "/api/auth/42/callback"
            )
    elif container["name"] == "web":
        overrides = {"SITE_ADDRESS": site}
        if admin_host:
            overrides["ADMIN_SITE_ADDRESS"] = admin_host
        try:
            ipaddress.IPv4Address(host)
        except ipaddress.AddressValueError:
            pass
        else:
            # IP clients omit SNI. Behind Podman/EC2 NAT, Caddy otherwise looks
            # for a certificate for its private listener IP instead of APP_ORIGIN.
            # Keep the repo's routes/headers and generate config in the existing
            # writable /config mount on every start (the image root is read-only).
            caddyfile = Path("deploy/Caddyfile").read_text()
            if not caddyfile.startswith("{\n"):
                fail("deploy/Caddyfile must begin with its global options block.")
            caddyfile = caddyfile.replace(
                "{\n", f"{{\n\tdefault_sni {host}\n\tlocal_certs\n\tskip_install_trust\n", 1
            )
            container["command"] = ["/bin/sh", "-ec"]
            container["args"] = [
                "umask 077\nprintf '%s' " + shlex.quote(caddyfile) + " > /config/Caddyfile\n"
                "exec caddy run --config /config/Caddyfile --adapter caddyfile"
            ]
            print("IPv4 HTTPS: using the public IP as Caddy's default TLS server name "
                  "with an internal CA certificate.")
    entries = {entry["name"]: entry for entry in container.get("env", [])}
    if container["name"] == "backend" and ("SMTP_PASSWORD" in env or backend.get("smtp-password")):
        # Replace legacy manual password entries too, including when explicitly cleared.
        entries.pop("SMTP_PASSWORD", None)
        entries.pop("SMTP_PASSWORD_FILE", None)
    entries.update({key: {"name": key, "value": value} for key, value in overrides.items()})
    container["env"] = list(entries.values())

out = Path(sys.argv[1])
(out / "secrets.yaml").write_text(yaml.safe_dump_all(documents, sort_keys=False))
(out / "pod.yaml").write_text(yaml.safe_dump(pod, sort_keys=False))
(out / "settings").write_text(f"{host}\n{origin}\n{env['DEMO_LOGIN_ENABLED']}\n")
PY
  pod_file="$work_dir/pod.yaml"
  { read -r health_host; read -r app_origin; read -r seed_demo; } < "$work_dir/settings"
else
  # Preserve the existing local/Vagrant entry point without adding Python dependencies.
  make demo-secrets
fi

health_timeout=${OTUS_HEALTH_TIMEOUT:-600}
[[ "$health_timeout" =~ ^[1-9][0-9]*$ ]] || fail 'OTUS_HEALTH_TIMEOUT must be a positive number of seconds.'

# Finish every image before replacing the running pod or changing its secrets.
podman --version
make images
if [ -f "$work_dir/secrets.yaml" ]; then
  # Rename on the same filesystem so interruption cannot leave a partial secrets file.
  secrets_next=$(mktemp deploy/.secrets.XXXXXX)
  cp "$work_dir/secrets.yaml" "$secrets_next"
  mv -f "$secrets_next" deploy/secrets.yaml
fi

deploy_started=true
# Secret mounts are named volumes too. Recreate only these two after stopping the pod
# so OAuth changes reach the new containers. Persistent application volumes stay intact.
otus_pod_exists() {
  local status
  if podman pod exists otus; then
    return 0
  else
    status=$?
  fi
  # Only exit 1 means absent; storage/runtime errors must stop the deployment.
  [ "$status" -eq 1 ] || fail "Cannot determine whether the otus pod exists (exit $status)."
  return 1
}

if otus_pod_exists; then
  # Podman can remove containers yet leave their pod behind when rootless network
  # teardown fails (e.g. an AppArmor denial when signalling pasta). Finish that
  # partial removal through Podman, without resetting storage or deleting volumes.
  teardown_error='rootless netns: kill network process: permission denied|pod has no infra container'
  if podman pod stop --time 30 otus > "$work_dir/pod-stop.log" 2>&1; then
    cat "$work_dir/pod-stop.log"
  else
    cat "$work_dir/pod-stop.log" >&2
    if ! grep -Eq "$teardown_error" "$work_dir/pod-stop.log"; then
      fail 'Cannot stop the otus pod; aborting before replacing its secret volumes.'
    fi
    printf 'Pod shutdown reported a rootless/infra cleanup error; checking removal next.\n'
  fi
  pod_removed=false
  for attempt in 1 2 3; do
    if podman pod rm --force --ignore otus > "$work_dir/pod-remove.log" 2>&1; then
      cat "$work_dir/pod-remove.log"
    else
      cat "$work_dir/pod-remove.log" >&2
      if ! grep -Eq "$teardown_error" "$work_dir/pod-remove.log"; then
        fail 'Cannot remove the otus pod; aborting before replacing its secret volumes.'
      fi
    fi
    if ! otus_pod_exists; then
      pod_removed=true
      break
    fi
    if [ "$attempt" -lt 3 ]; then
      printf 'The otus pod still exists after cleanup attempt %s/3; retrying removal.\n' "$attempt"
      sleep 2
    fi
  done
  [ "$pod_removed" = true ] || fail 'The otus pod remains after 3 cleanup attempts. Check host Podman/AppArmor network errors; persistent volumes have been preserved.'
fi

# Do not recreate secret mounts or start a new pod while old app containers remain.
for container in otus-db otus-backend otus-clamav otus-web; do
  if podman container exists "$container"; then
    fail "Container $container still exists after pod cleanup; refusing to replace secret volumes."
  else
    exists_status=$?
  fi
  [ "$exists_status" -eq 1 ] || fail "Cannot check container $container (exit $exists_status)."
done
for volume in otus-db otus-backend; do
  if podman volume exists "$volume"; then
    podman volume rm "$volume"
  fi
done
podman kube play --replace deploy/secrets.yaml
podman kube play --replace "$pod_file"

# POSTGRES_PASSWORD_FILE / OTUS_APP_PASSWORD_FILE initialize an empty DB only;
# replacing secret mounts does not update roles in an existing data volume.
# Read both passwords inside the DB container, never into host arguments or logs.
check_database_credentials() {
  podman exec -i otus-db /bin/sh -se <<'DB'
export LC_ALL=C PGCONNECT_TIMEOUT=3
export PGOPTIONS='-c statement_timeout=5000 -c password_encryption=scram-sha-256'
app_password=$(cat "$OTUS_APP_PASSWORD_FILE")
test -n "$app_password" || { echo 'ERROR: Saved app password is empty.' >&2; exit 1; }
# psql's password prompt consumes one line at a time.
case "$app_password" in
  *'
'*|*"$(printf '\r')"*) echo 'ERROR: Saved app password must be a single line.' >&2; exit 1 ;;
esac
check_app() {
  PGPASSWORD="$app_password" psql -X -w -h 127.0.0.1 -p 5432 -U otus -d otus \
    -v ON_ERROR_STOP=1 -Atqc 'SELECT 1'
}
if app_result=$(check_app 2>&1); then
  echo 'Database credentials verified.'
  exit 0
fi
case "$app_result" in
  *'password authentication failed for user "otus"'*) ;;
  *) printf '%s\n' "$app_result" >&2; exit 1 ;;
esac
echo 'The stored otus role password differs from the deployment secret; checking administrator access.'
PGPASSWORD=$(cat "$POSTGRES_PASSWORD_FILE")
export PGPASSWORD
if ! psql -X -w -h 127.0.0.1 -p 5432 -U postgres -d postgres -Atqc 'SELECT 1' >/dev/null; then
  echo 'ERROR: Saved administrator password cannot access the existing database. Restore the matching deploy/secrets.yaml or recover administrator access before deploying. No database data was removed.' >&2
  exit 1
fi
# No TTY is allocated: \password reads stdin and hashes the password client-side,
# so even PostgreSQL statement logging cannot record its plaintext value.
printf '%s\n%s\n' "$app_password" "$app_password" | \
  psql -X -w -q -h 127.0.0.1 -p 5432 -U postgres -d postgres \
    -v ON_ERROR_STOP=1 -c '\password otus'
check_app >/dev/null
echo 'Database role password reconciled and verified; existing data and encryption keys are unchanged.'
DB
}

# Keep the public URL/Host while connecting locally. DNS names also supply SNI;
# IP URLs omit it, so the rendered Caddy config sets default_sni for those requests.
# Caddy's internal CA needs --insecure for this local readiness probe.
curl_options=(--insecure --silent --show-error --noproxy '*' --connect-timeout 2 --max-time 5
  --connect-to "${health_host}:8443:127.0.0.1:8443")
health_url="https://${health_host}:8443"
printf 'Waiting for the API, database and malware scanner ...\n'
deadline=$((SECONDS + health_timeout))
next_report=$SECONDS
startup_logs_at=$((SECONDS + 15))
database_checked=false
[ -f deploy/.env ] || database_checked=true
ready=false
while ((SECONDS < deadline)); do
  # Wait for the final TCP listener, not the temporary socket-only init server.
  if [ "$database_checked" = false ] && \
      podman exec otus-db pg_isready -q -h 127.0.0.1 -p 5432 -U postgres -d postgres -t 2; then
    check_database_credentials || fail 'Database credential check/reconciliation failed; see the database error above.'
    database_checked=true
  fi
  status=$(curl "${curl_options[@]}" --output "$work_dir/health.json" --write-out '%{http_code}' \
    "$health_url/api/health") || status=000
  if [ "$database_checked" = true ] && [ "$status" = 200 ] && \
      grep -Eq '"scanner"[[:space:]]*:[[:space:]]*"ready"' "$work_dir/health.json"; then
    ready=true
    break
  fi
  if ((SECONDS >= next_report)); then
    case "$status" in
      000) reason='HTTPS connection is not ready' ;;
      502) reason='Caddy cannot reach the backend; check backend/database startup logs' ;;
      200) reason='API responded; waiting for database credential verification or scanner readiness' ;;
      *) reason='API health request failed; check backend/database logs' ;;
    esac
    printf 'Readiness: HTTP %s; %s (%ss remaining).\n' "$status" "$reason" "$((deadline - SECONDS))"
    podman ps -a --pod --filter pod=otus || true
    next_report=$((SECONDS + 15))
  fi
  if [ "$startup_logs_at" -gt 0 ] && ((SECONDS >= startup_logs_at)); then
    for container in otus-db otus-backend otus-clamav otus-web; do
      printf '\n--- %s startup logs ---\n' "$container"
      podman logs --tail 20 "$container" >&2 || true
    done
    startup_logs_at=0
  fi
  sleep 2
done
[ "$ready" = true ] || fail "API/database/scanner did not become ready within ${health_timeout}s."
status=$(curl "${curl_options[@]}" --output /dev/null --write-out '%{http_code}' "$health_url/api/me") || status=000
[ "$status" = 401 ] || fail "Unauthenticated /api/me must return 401 for the login page to load (HTTP $status)."
status=$(curl "${curl_options[@]}" --output /dev/null --write-out '%{http_code}' "$health_url/") || status=000
[ "$status" = 200 ] || fail "Frontend health check failed (HTTP $status)."

if [ "$seed_demo" = true ]; then
  podman exec otus-backend otus-backend seed
  printf 'Demo accounts: dongmin, seoyeon, or any new ID\n'
fi
printf '\nOTUS is running: %s\n' "$app_origin"

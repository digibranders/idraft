#!/usr/bin/env bash
# One-time, on a fresh Ubuntu 24.04 VPS as root: builds the hand-made systemd install that infra/ship.sh deploys into
# (the layout of docs/ops/release-and-deploy.md). Written for a host that other projects share: it only adds things
# (its own user, its own PostgreSQL 18 cluster on 5433, its own Redis instance on 6380, its own nginx site) and never
# touches what is already there. Ports: api 127.0.0.1:8010, web 127.0.0.1:3010, postgres 5433, redis 6380.
#
#   provision.sh install   everything up to a nginx site with a self-signed stand-in certificate (the default)
#   provision.sh tls       after DNS points here: replaces the stand-in with a Let's Encrypt certificate
#
# Needs a secrets file (default /root/idraft-secrets.env, mode 0600, removed by the operator when done), plain
# NAME=value lines: DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD, R2_RAW_ENDPOINT, R2_RAW_BUCKET, R2_RAW_ACCESS_KEY_ID,
# R2_RAW_SECRET_ACCESS_KEY, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, EMAIL_API_KEY, EMAIL_FROM.
# Passwords and keys that belong to this install (database roles, Redis, the encryption keys, the health token) are
# generated here, once: a second run keeps the env files it finds. Nothing secret is printed.
#
#   scp -r infra/vps root@<host>:/root/idraft-vps && ssh root@<host> bash /root/idraft-vps/provision.sh
#
# After it: infra/ship.sh deploys the code (SHIP_HOST=root@<host>), then the first operator is created with
# `python -m idraft.cli create-operator` (docs/ops/release-and-deploy.md).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
domain=app.idraft.ai
node_version="${NODE_VERSION:-v24.22.2}"
secrets="${IDRAFT_SECRETS:-/root/idraft-secrets.env}"
env_dir=/etc/idraft
pg_port=5433
redis_port=6380

log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "run as root"

# Prints the value of NAME in an env file, or nothing.
value_of() { sed -n "s/^$1=//p" "$2" 2>/dev/null | head -n 1; }

install_packages() {
  log "1. Packages"
  export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l
  apt-get install -y -qq curl ca-certificates openssl >/dev/null
  if [ ! -f /etc/apt/sources.list.d/pgdg.list ]; then
    install -d /usr/share/postgresql-common/pgdg
    curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
    # shellcheck disable=SC1091
    codename="$(. /etc/os-release && echo "$VERSION_CODENAME")"
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${codename}-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list
    apt-get update -qq
  fi
  apt-get install -y -qq postgresql-18 >/dev/null
}

install_runtimes() {
  log "2. User, folders, Python 3.13 and Node ${node_version}"
  id idraft >/dev/null 2>&1 || useradd --system --home-dir /srv/idraft --shell /usr/sbin/nologin idraft
  install -d -o idraft -g idraft -m 0755 /srv/idraft /srv/idraft/.cache
  install -d -m 0700 /srv/idraft/backups /srv/idraft/incoming
  install -d -m 0750 -o root -g idraft "$env_dir"
  UV_PYTHON_INSTALL_DIR=/opt/uv-python /usr/local/bin/uv python install 3.13 >/dev/null
  chmod -R a+rX /opt/uv-python
  if [ ! -x "/opt/node-$node_version/bin/node" ]; then
    local tmp name="node-$node_version-linux-x64"
    tmp="$(mktemp -d)"
    curl -fsSL -o "$tmp/$name.tar.xz" "https://nodejs.org/dist/$node_version/$name.tar.xz"
    curl -fsSL -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/$node_version/SHASUMS256.txt"
    (cd "$tmp" && grep " $name.tar.xz\$" SHASUMS256.txt | sha256sum -c --quiet -) || die "the Node download does not match its checksum"
    tar -xJf "$tmp/$name.tar.xz" -C /opt
    mv "/opt/$name" "/opt/node-$node_version"
    rm -rf "$tmp"
  fi
  ln -sfn "/opt/node-$node_version" /opt/node
}

generate_env() {
  log "3. Environment files in $env_dir"
  if [ -f "$env_dir/db.env" ]; then
    log "   found, kept"
    return
  fi
  [ -f "$secrets" ] || die "the secrets file $secrets is missing"
  local p_mig p_api p_wrk p_redis totp skey health
  p_mig="$(openssl rand -hex 24)"
  p_api="$(openssl rand -hex 24)"
  p_wrk="$(openssl rand -hex 24)"
  p_redis="$(openssl rand -hex 24)"
  totp="$(openssl rand -base64 32)"
  skey="$(openssl rand -base64 32)"
  health="$(openssl rand -base64 33 | tr '+/' '-_' | tr -d '=\n')"
  # shellcheck disable=SC1090
  (
    set -a
    . "$secrets"
    set +a
    umask 027
    db="127.0.0.1:$pg_port/idraft"
    redis="redis://:$p_redis@127.0.0.1:$redis_port/0"
    shared_provider="DATAFORSEO_LOGIN=${DATAFORSEO_LOGIN:?}
DATAFORSEO_PASSWORD=${DATAFORSEO_PASSWORD:?}
R2_RAW_ENDPOINT=${R2_RAW_ENDPOINT:?}
R2_RAW_BUCKET=${R2_RAW_BUCKET:?}
R2_RAW_ACCESS_KEY_ID=${R2_RAW_ACCESS_KEY_ID:?}
R2_RAW_SECRET_ACCESS_KEY=${R2_RAW_SECRET_ACCESS_KEY:?}
GOOGLE_OAUTH_CLIENT_ID=${GOOGLE_OAUTH_CLIENT_ID:?}
GOOGLE_OAUTH_CLIENT_SECRET=${GOOGLE_OAUTH_CLIENT_SECRET:?}
SECRETS_ENCRYPTION_KEY=$skey
INSTALLATION_ID=prod"
    cat > "$env_dir/api.env" <<ENV
PROCESS_ROLE=api
APP_ENV=production
APP_ORIGIN=https://$domain
LOG_LEVEL=info
DATABASE_URL=postgresql://app_api:$p_api@$db
REDIS_URL=$redis
TOTP_ENCRYPTION_KEY=$totp
HEALTH_TOKEN=$health
REGISTRATION=invited
EMAIL_PROVIDER=brevo
EMAIL_FROM=${EMAIL_FROM:-idraft.ai <hello@idraft.ai>}
EMAIL_API_KEY=${EMAIL_API_KEY:-REPLACE_WITH_BREVO_API_KEY}
$shared_provider
ENV
    cat > "$env_dir/worker.env" <<ENV
PROCESS_ROLE=worker
APP_ENV=production
APP_ORIGIN=https://$domain
LOG_LEVEL=info
DATABASE_URL=postgresql://app_worker:$p_wrk@$db
REDIS_URL=$redis
HEARTBEAT_FILE=/run/idraft-worker/heartbeat
$shared_provider
ENV
    printf 'DATABASE_URL=postgresql://migrator:%s@%s\nLOG_LEVEL=info\n' "$p_mig" "$db" > "$env_dir/migrator.env"
    umask 077
    printf 'PG_MIGRATOR_PASSWORD=%s\nPG_API_PASSWORD=%s\nPG_WORKER_PASSWORD=%s\n' "$p_mig" "$p_api" "$p_wrk" > "$env_dir/db.env"
    printf 'REDIS_PASSWORD=%s\n' "$p_redis" > "$env_dir/redis.env"
  )
  chown root:idraft "$env_dir/api.env" "$env_dir/worker.env" "$env_dir/migrator.env"
  chown root:root "$env_dir/db.env" "$env_dir/redis.env"
  chmod 0640 "$env_dir/api.env" "$env_dir/worker.env" "$env_dir/migrator.env"
  chmod 0600 "$env_dir/db.env" "$env_dir/redis.env"
}

setup_postgres() {
  log "4. PostgreSQL 18 on 127.0.0.1:$pg_port"
  # The package makes no cluster here, and the 16 cluster of the other project holds 5432: 18/main gets its own port.
  pg_lsclusters -h | awk '$1 == 18 && $2 == "main" {found = 1} END {exit !found}' || pg_createcluster 18 main --port="$pg_port"
  [ "$(pg_lsclusters -h | awk '$1 == 18 && $2 == "main" {print $3}')" = "$pg_port" ] ||
    die "cluster 18/main is not on port $pg_port: $(pg_lsclusters -h | tr '\n' ';')"
  install -m 0644 "$here/postgres/idraft.conf" /etc/postgresql/18/main/conf.d/idraft.conf
  systemctl restart postgresql@18-main
  local psql=(runuser -u postgres -- psql -p "$pg_port" -v ON_ERROR_STOP=1 -qtA)
  if [ "$("${psql[@]}" -d postgres -c "SELECT 1 FROM pg_database WHERE datname = 'idraft'")" = 1 ]; then
    log "   database idraft exists, roles kept"
    return
  fi
  "${psql[@]}" -d postgres -c "CREATE DATABASE idraft"
  # The roles of ADR-022, as infra/compose/postgres/initdb/10-roles.sh makes them. The passwords reach psql through
  # its environment (\getenv), never a command line.
  set -a
  # shellcheck disable=SC1091
  . "$env_dir/db.env"
  set +a
  export PG_MIGRATOR_PASSWORD PG_API_PASSWORD PG_WORKER_PASSWORD
  "${psql[@]}" -d idraft <<'SQL'
\getenv migrator_password PG_MIGRATOR_PASSWORD
\getenv api_password PG_API_PASSWORD
\getenv worker_password PG_WORKER_PASSWORD
CREATE ROLE migrator LOGIN PASSWORD :'migrator_password';
ALTER ROLE migrator SET lock_timeout = '2s';
ALTER ROLE migrator SET statement_timeout = '15min';
CREATE ROLE app_api LOGIN NOBYPASSRLS PASSWORD :'api_password';
ALTER ROLE app_api SET statement_timeout = '15s';
CREATE ROLE app_worker LOGIN BYPASSRLS PASSWORD :'worker_password';
ALTER ROLE app_worker SET statement_timeout = '120s';
GRANT pg_read_all_stats TO app_worker;
ALTER DATABASE idraft OWNER TO migrator;
REVOKE ALL ON DATABASE idraft FROM PUBLIC;
GRANT CONNECT ON DATABASE idraft TO app_api, app_worker;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SQL
  unset PG_MIGRATOR_PASSWORD PG_API_PASSWORD PG_WORKER_PASSWORD
}

setup_redis() {
  log "5. Redis instance idraft on 127.0.0.1:$redis_port"
  local password
  password="$(value_of REDIS_PASSWORD "$env_dir/redis.env")"
  [ -n "$password" ] || die "no Redis password in $env_dir/redis.env"
  install -m 0640 -o redis -g redis /dev/null /etc/redis/redis-idraft.conf
  # The unit of the packaged template may write /var/lib/redis and /var/log/redis only, so the files get their own names
  # there: the Redis of the other project keeps its own.
  cat > /etc/redis/redis-idraft.conf <<CONF
bind 127.0.0.1
port $redis_port
protected-mode yes
requirepass $password
maxmemory 512mb
maxmemory-policy noeviction
appendonly yes
appendfsync everysec
aof-use-rdb-preamble yes
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
save 900 1
save 300 100
dir /var/lib/redis
dbfilename dump-idraft.rdb
appendfilename "appendonly-idraft.aof"
appenddirname "appendonlydir-idraft"
pidfile /run/redis-idraft/redis-server.pid
logfile /var/log/redis/redis-server-idraft.log
enable-debug-command no
tcp-keepalive 300
CONF
  systemctl enable --now redis-server@idraft >/dev/null
}

setup_units() {
  log "6. systemd units and release folders"
  for unit in api worker web; do
    install -m 0644 "$here/systemd/idraft-$unit.service" "/etc/systemd/system/idraft-$unit.service"
  done
  local part
  for part in backend web; do
    install -d -m 0755 "/srv/idraft/releases/$part" "/srv/idraft/releases/$part/bootstrap"
    [ -L "/srv/idraft/releases/$part/current" ] || ln -sfn "/srv/idraft/releases/$part/bootstrap" "/srv/idraft/releases/$part/current"
    [ -L "/srv/idraft/$part" ] || ln -sfn "/srv/idraft/releases/$part/current" "/srv/idraft/$part"
  done
  chown -R idraft:idraft /srv/idraft/releases
  install -m 0755 "$here/activate.sh" /usr/local/sbin/idraft-activate
  systemctl daemon-reload
  # Not started: there is no code yet. The first `infra/ship.sh` run starts them.
  systemctl enable idraft-api idraft-worker idraft-web >/dev/null 2>&1
}

setup_nginx() {
  log "7. nginx site $domain"
  install -d /var/www/idraft-acme /etc/nginx/idraft-tls
  if [ ! -f /etc/nginx/idraft-tls.conf ]; then
    openssl req -x509 -nodes -newkey rsa:2048 -days 90 -subj "/CN=$domain" \
      -keyout /etc/nginx/idraft-tls/privkey.pem -out /etc/nginx/idraft-tls/fullchain.pem 2>/dev/null
    chmod 0600 /etc/nginx/idraft-tls/privkey.pem
    printf 'ssl_certificate /etc/nginx/idraft-tls/fullchain.pem;\nssl_certificate_key /etc/nginx/idraft-tls/privkey.pem;\n' > /etc/nginx/idraft-tls.conf
  fi
  install -m 0644 "$here/nginx/app.idraft.ai.conf" /etc/nginx/sites-available/idraft
  ln -sfn /etc/nginx/sites-available/idraft /etc/nginx/sites-enabled/idraft
  nginx -t
  systemctl reload nginx
}

install_all() {
  install_packages
  install_runtimes
  generate_env
  setup_postgres
  setup_redis
  setup_units
  setup_nginx
  log "Done. Next: point $domain here (Cloudflare, proxied), run 'provision.sh tls', then infra/ship.sh."
}

tls() {
  log "Let's Encrypt certificate for $domain"
  certbot certonly --webroot -w /var/www/idraft-acme -d "$domain" --non-interactive --agree-tos \
    --register-unsafely-without-email --deploy-hook 'systemctl reload nginx'
  printf 'ssl_certificate /etc/letsencrypt/live/%s/fullchain.pem;\nssl_certificate_key /etc/letsencrypt/live/%s/privkey.pem;\n' \
    "$domain" "$domain" > /etc/nginx/idraft-tls.conf
  nginx -t
  systemctl reload nginx
  log "Done. Set Cloudflare's SSL mode for the zone to Full (strict)."
}

case "${1:-install}" in
  install) install_all ;;
  tls) tls ;;
  *) die "usage: provision.sh [install|tls]" ;;
esac

#!/usr/bin/env bash
# Runs on the VPS as root. Installs an uploaded release of the backend and/or the web app into the
# systemd install, switches to it, checks it, and switches back by itself when a check fails.
#
# Usage:
#   activate.sh deploy <sha> <stage-dir>    stage-dir holds backend.tar and/or web.tar.gz (from infra/ship.sh)
#   activate.sh rollback <backend|web>      back to the previous release of one component
#
# Layout:
#   /srv/idraft/releases/<component>/<sha>/      one folder per release
#   /srv/idraft/releases/<component>/current     link to the serving release, previous to the one before
#   /srv/idraft/backend, /srv/idraft/web         links to .../current (the paths the units use)
# Migrations are forward-only (docs/22 section 8.5): a switch back runs the previous code on the new schema.
set -euo pipefail

releases=/srv/idraft/releases
backups=/srv/idraft/backups
keep_releases=5
keep_backups=10
api_ready=http://127.0.0.1:8000/api/readyz
web_ready=http://127.0.0.1:3010/login
heartbeat=/run/idraft-worker/heartbeat

log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

units_of() {
  case "$1" in
    backend) echo "idraft-api idraft-worker" ;;
    web) echo "idraft-web" ;;
    *) die "unknown component: $1" ;;
  esac
}

# Release folders are named by commit; anything else in a link target is refused.
sha_of_link() { basename "$(readlink -f "$1")"; }

# The units read RELEASE_SHA from a drop-in, so the health report names the commit that serves.
write_release_dropin() {
  local unit="$1" sha="$2" dir="/etc/systemd/system/$1.service.d"
  install -d -m 0755 "$dir"
  printf '[Service]\nEnvironment=RELEASE_SHA=%s\n' "$sha" > "$dir/release.conf.tmp"
  mv -f "$dir/release.conf.tmp" "$dir/release.conf"
}

point() {
  # point <component> <link name> <target folder>: an atomic replace of the link
  ln -sfn "$3" "$releases/$1/.$2.tmp"
  mv -Tf "$releases/$1/.$2.tmp" "$releases/$1/$2"
}

start_on() {
  # start_on <component> <sha>: serve that release
  local component="$1" sha="$2" unit
  point "$component" current "$releases/$component/$sha"
  for unit in $(units_of "$component"); do
    write_release_dropin "$unit" "$sha"
  done
  systemctl daemon-reload
  # shellcheck disable=SC2046
  systemctl restart $(units_of "$component")
}

wait_for() {
  # wait_for <seconds> <description> <command...>
  local seconds="$1" what="$2" i
  shift 2
  for ((i = 0; i < seconds; i++)); do
    if "$@" >/dev/null 2>&1; then
      log "ok: $what"
      return 0
    fi
    sleep 1
  done
  log "FAILED: $what (not within ${seconds}s)"
  return 1
}

http_200() { [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$1")" = 200 ]; }

worker_fresh() {
  # The worker rewrites the heartbeat every few seconds; one written after the restart counts.
  [ -f "$heartbeat" ] && [ "$(stat -c %Y "$heartbeat")" -ge "$1" ]
}

healthy() {
  local component="$1" since="$2" unit
  for unit in $(units_of "$component"); do
    systemctl is-active --quiet "$unit" || { log "FAILED: $unit is not active"; return 1; }
  done
  case "$component" in
    backend)
      wait_for 60 "api /api/readyz" http_200 "$api_ready" &&
        wait_for 60 "worker heartbeat" worker_fresh "$since"
      ;;
    web) wait_for 60 "web /login" http_200 "$web_ready" ;;
  esac
}

backup_database() {
  local file
  install -d -m 0700 "$backups"
  file="$backups/pre-$1-$(date -u +%Y%m%dT%H%M%SZ).dump"
  # postgres reads the database, root writes the file into the root-only folder. The Ubuntu
  # pg_dump wrapper picks version 16, which cannot dump this PostgreSQL 18 cluster.
  # shellcheck disable=SC2024
  sudo -u postgres /usr/lib/postgresql/18/bin/pg_dump -p 5433 -Fc -d idraft > "$file"
  chmod 0600 "$file"
  log "database backed up: $file ($(du -h "$file" | cut -f1))"
  # shellcheck disable=SC2012
  ls -1t "$backups"/pre-*.dump | tail -n +$((keep_backups + 1)) | xargs -r rm -f
}

migrate() {
  # Same environment file and user as before; nothing secret reaches a command line.
  systemd-run --wait --pipe --collect --quiet \
    -p User=idraft -p EnvironmentFile=/etc/idraft/migrator.env \
    -p WorkingDirectory="$1" -E PYTHONUNBUFFERED=1 \
    "$1/.venv/bin/python" -m idraft.db.migrate
}

install_backend() {
  local sha="$1" tarball="$2" dir="$releases/backend/$1"
  # The stage is root-only, so root extracts and then hands the tree to the service user.
  rm -rf "$dir" && install -d "$dir"
  tar -x -f "$tarball" -C "$dir" --strip-components=1 --no-same-owner
  chown -R idraft:idraft "$dir"
  log "backend: installing dependencies"
  (cd "$dir" && runuser -u idraft -- env HOME=/srv/idraft UV_CACHE_DIR=/srv/idraft/.cache/uv \
    UV_PYTHON_INSTALL_DIR=/opt/uv-python UV_PYTHON_DOWNLOADS=never \
    /usr/local/bin/uv sync --frozen --no-dev --quiet)
}

install_web() {
  local sha="$1" tarball="$2" dir="$releases/web/$1"
  rm -rf "$dir" && install -d "$dir"
  tar -x -z -f "$tarball" -C "$dir" --no-same-owner
  chown -R idraft:idraft "$dir"
  [ -f "$dir/apps/web/server.js" ] || die "web: the package has no apps/web/server.js"
}

prune() {
  local component="$1" keep_a keep_b
  keep_a="$(sha_of_link "$releases/$component/current")"
  keep_b="$(sha_of_link "$releases/$component/previous" 2>/dev/null || true)"
  # Folder names are commits (or legacy-<date>), written by this script only.
  # shellcheck disable=SC2010,SC2012
  ls -1t "$releases/$component" | grep -E '^[0-9a-f]{7,40}$|^legacy-' | grep -vxF -e "$keep_a" -e "${keep_b:-none}" \
    | tail -n +$((keep_releases - 1)) | while read -r old; do rm -rf "${releases:?}/$component/$old"; done
}

deploy() {
  local sha="$1" stage="$2" component since failed=0 installed=() switched=()
  [[ "$sha" =~ ^[0-9a-f]{7,40}$ ]] || die "not a commit: $sha"
  [ -d "$stage" ] || die "no stage folder: $stage"
  for component in backend web; do
    [ -L "$releases/$component/current" ] || die "$releases/$component/current is missing: run the one-time conversion"
  done

  if [ -f "$stage/backend.tar" ]; then
    install_backend "$sha" "$stage/backend.tar"
    backup_database "$sha"
    log "backend: migrating"
    migrate "$releases/backend/$sha" || die "migration failed; nothing was switched (backup above)"
    installed+=(backend)
  fi
  if [ -f "$stage/web.tar.gz" ]; then
    install_web "$sha" "$stage/web.tar.gz"
    installed+=(web)
  fi
  [ "${#installed[@]}" -gt 0 ] || die "the stage holds neither backend.tar nor web.tar.gz"

  for component in "${installed[@]}"; do
    point "$component" previous "$(readlink -f "$releases/$component/current")"
    since="$(date +%s)"
    log "$component: switching to $sha"
    start_on "$component" "$sha"
    switched+=("$component")
    if ! healthy "$component" "$since"; then
      failed=1
      break
    fi
  done

  if [ "$failed" = 1 ]; then
    for component in "${switched[@]}"; do
      log "$component: switching back to $(sha_of_link "$releases/$component/previous")"
      start_on "$component" "$(sha_of_link "$releases/$component/previous")"
      healthy "$component" "$(date +%s)" || log "$component: STILL UNHEALTHY after switching back"
    done
    echo "$(date -u +%FT%TZ) FAILED $sha ${switched[*]}" >> "$releases/history.log"
    die "release $sha failed its checks and was switched back"
  fi

  for component in "${switched[@]}"; do
    prune "$component"
    echo "$(date -u +%FT%TZ) $component $sha" >> "$releases/history.log"
  done
  rm -rf "$stage"
  log "release $sha serves: ${switched[*]:-nothing to switch}"
}

rollback() {
  local component="$1" target
  units_of "$component" >/dev/null
  [ -L "$releases/$component/previous" ] && [ -d "$(readlink -f "$releases/$component/previous")" ] ||
    die "$component has no previous release"
  target="$(sha_of_link "$releases/$component/previous")"
  point "$component" previous "$(readlink -f "$releases/$component/current")"
  log "$component: rolling back to $target"
  start_on "$component" "$target"
  healthy "$component" "$(date +%s)" || die "$component is unhealthy after the rollback"
  echo "$(date -u +%FT%TZ) ROLLBACK $component $target" >> "$releases/history.log"
}

[ "$(id -u)" = 0 ] || die "run as root"
exec 9>/run/idraft-activate.lock
flock -n 9 || die "another release is being activated"

case "${1:-}" in
  deploy) [ $# = 3 ] || die "usage: activate.sh deploy <sha> <stage-dir>"; deploy "$2" "$3" ;;
  rollback) [ $# = 2 ] || die "usage: activate.sh rollback <backend|web>"; rollback "$2" ;;
  *) die "usage: activate.sh deploy <sha> <stage-dir> | rollback <backend|web>" ;;
esac

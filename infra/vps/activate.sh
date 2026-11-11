#!/usr/bin/env bash
# Runs on the VPS as root (installed as /usr/local/sbin/idraft-activate). Installs an uploaded release of
# the backend and/or the web app into the systemd install, switches to it, checks it, and switches back by
# itself when a check fails.
#
# Usage:
#   idraft-activate deploy <sha> <stage-dir>   stage-dir holds backend.tar and/or web.tar.gz (infra/ship.sh)
#   idraft-activate rollback <backend|web>     back to the previous release of one part
#   idraft-activate deployed <backend|web>     prints the commit that serves (or legacy-<date>)
#
# Layout:
#   /srv/idraft/releases/<part>/<sha>/      one folder per release
#   /srv/idraft/releases/<part>/current     link to the serving release, previous to the one before
#   /srv/idraft/backend, /srv/idraft/web    links to .../current (the paths the units use)
# Migrations are forward-only (docs/22 section 8.5): a switch back runs the previous code on the new schema.
set -euo pipefail
# A dropped ssh session must not stop a release between the switch and the switch back.
trap '' HUP PIPE

releases=/srv/idraft/releases
backups=/srv/idraft/backups
keep_releases=5
keep_backups=10
api_ready=http://127.0.0.1:8010/api/readyz
web_ready=http://127.0.0.1:3010/login
heartbeat=/run/idraft-worker/heartbeat

log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*" || true; }
die() { log "ERROR: $*" >&2; exit 1; }

units_of() {
  case "$1" in
    backend) echo "idraft-api idraft-worker" ;;
    web) echo "idraft-web" ;;
    *) die "unknown part: $1" ;;
  esac
}

sha_of_link() { basename "$(readlink -f "$1")"; }

# The units read RELEASE_SHA from a drop-in, so the health report names the commit that serves.
write_release_dropin() {
  local dir="/etc/systemd/system/$1.service.d"
  install -d -m 0755 "$dir" &&
    printf '[Service]\nEnvironment=RELEASE_SHA=%s\n' "$2" > "$dir/release.conf.tmp" &&
    mv -f "$dir/release.conf.tmp" "$dir/release.conf"
}

point() {
  # point <part> <link name> <target folder>: an atomic replace of the link
  ln -sfn "$3" "$releases/$1/.$2.tmp" && mv -Tf "$releases/$1/.$2.tmp" "$releases/$1/$2"
}

start_on() {
  # start_on <part> <release folder name>: serve that release. One && chain, so a failure anywhere is
  # this function's status even where the caller has set -e off.
  local part="$1" name="$2" unit units
  units="$(units_of "$part")"
  point "$part" current "$releases/$part/$name" || return 1
  for unit in $units; do
    write_release_dropin "$unit" "$name" || return 1
  done
  # shellcheck disable=SC2086
  systemctl daemon-reload && systemctl restart $units
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
  # The worker rewrites the heartbeat every few seconds; one written since the restart counts.
  [ -f "$heartbeat" ] && [ "$(stat -c %Y "$heartbeat")" -ge "$1" ]
}

healthy() {
  local part="$1" since="$2" unit
  for unit in $(units_of "$part"); do
    systemctl is-active --quiet "$unit" || { log "FAILED: $unit is not active"; return 1; }
  done
  case "$part" in
    backend)
      wait_for 60 "api /api/readyz" http_200 "$api_ready" &&
        wait_for 60 "worker heartbeat" worker_fresh "$since"
      ;;
    web) wait_for 60 "web /login" http_200 "$web_ready" ;;
  esac
}

switch_to() {
  # switch_to <part> <release folder name>: start it and check it
  local since
  since="$(date +%s)"
  start_on "$1" "$2" && healthy "$1" "$since"
}

backup_database() {
  local file
  install -d -m 0700 "$backups"
  file="$backups/pre-$1-$(date -u +%Y%m%dT%H%M%SZ).dump"
  # postgres reads the database, root writes the file into the root-only folder. The Ubuntu
  # pg_dump wrapper picks version 16, which cannot dump this PostgreSQL 18 cluster.
  # shellcheck disable=SC2024
  if ! sudo -u postgres /usr/lib/postgresql/18/bin/pg_dump -p 5433 -Fc -d idraft > "$file"; then
    rm -f "$file"
    die "database backup failed; nothing was installed or switched"
  fi
  chmod 0600 "$file"
  log "database backed up: $file ($(du -h "$file" | cut -f1))"
  # shellcheck disable=SC2012
  ls -1t "$backups"/pre-*.dump | tail -n +$((keep_backups + 1)) | xargs -r rm -f
}

migrate() {
  # The units' own environment file and user; nothing secret reaches a command line.
  systemd-run --wait --pipe --collect --quiet \
    -p User=idraft -p EnvironmentFile=/etc/idraft/migrator.env -p RuntimeMaxSec=600 \
    -p WorkingDirectory="$1" -E PYTHONUNBUFFERED=1 -E RELEASE_SHA="$(basename "$1")" \
    "$1/.venv/bin/python" -m idraft.db.migrate
}

fresh_release_dir() {
  # fresh_release_dir <part> <sha>: an empty folder for it, never the serving or previous one
  local dir="$releases/$1/$2"
  [ "$(sha_of_link "$releases/$1/current")" != "$2" ] || die "$1 $2 is already serving"
  [ ! -L "$releases/$1/previous" ] || [ "$(sha_of_link "$releases/$1/previous")" != "$2" ] ||
    die "$1 $2 is the previous release: use rollback"
  rm -rf "$dir"
  install -d "$dir"
}

install_backend() {
  local dir="$releases/backend/$1"
  fresh_release_dir backend "$1"
  # The stage is root-only, so root extracts and then hands the tree to the service user.
  tar -x -f "$2" -C "$dir" --strip-components=1 --no-same-owner
  chown -R idraft:idraft "$dir"
  log "backend: installing dependencies"
  (cd "$dir" && runuser -u idraft -- env HOME=/srv/idraft UV_CACHE_DIR=/srv/idraft/.cache/uv \
    UV_PYTHON_INSTALL_DIR=/opt/uv-python UV_PYTHON_DOWNLOADS=never \
    /usr/local/bin/uv sync --frozen --no-dev --quiet)
  touch "$dir"
}

install_web() {
  local dir="$releases/web/$1"
  fresh_release_dir web "$1"
  tar -x -z -f "$2" -C "$dir" --no-same-owner
  chown -R idraft:idraft "$dir"
  [ -f "$dir/apps/web/server.js" ] || die "web: the package has no apps/web/server.js"
  touch "$dir"
}

prune() {
  # Keeps current, previous and the newest others up to keep_releases in all.
  local part="$1" keep_a keep_b old n=0
  keep_a="$(sha_of_link "$releases/$part/current")"
  keep_b="$(sha_of_link "$releases/$part/previous" 2>/dev/null || echo none)"
  # Folder names are commits or legacy-<date>, written by this script and setup-releases.sh only.
  # shellcheck disable=SC2012,SC2045
  for old in $(ls -1t "$releases/$part"); do
    case "$old" in current | previous | .*) continue ;; esac
    if [ "$old" = "$keep_a" ] || [ "$old" = "$keep_b" ]; then continue; fi
    n=$((n + 1))
    [ "$n" -le $((keep_releases - 2)) ] || rm -rf "${releases:?}/$part/$old"
  done
}

deploy() {
  local sha="$1" stage="$2" part failed=0 installed=() switched=()
  [[ "$sha" =~ ^[0-9a-f]{7,40}$ ]] || die "not a commit: $sha"
  [ -d "$stage" ] || die "no stage folder: $stage"
  for part in backend web; do
    [ -L "$releases/$part/current" ] || die "$releases/$part/current is missing: run setup-releases.sh"
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

  for part in "${installed[@]}"; do
    point "$part" previous "$(readlink -f "$releases/$part/current")"
    log "$part: switching to $sha"
    switched+=("$part")
    if ! switch_to "$part" "$sha"; then
      failed=1
      break
    fi
  done

  if [ "$failed" = 1 ]; then
    for part in "${switched[@]}"; do
      log "$part: switching back to $(sha_of_link "$releases/$part/previous")"
      switch_to "$part" "$(sha_of_link "$releases/$part/previous")" || log "$part: STILL UNHEALTHY after switching back"
    done
    echo "$(date -u +%FT%TZ) FAILED $sha ${switched[*]}" >> "$releases/history.log"
    die "release $sha failed its checks and was switched back"
  fi

  for part in "${switched[@]}"; do
    prune "$part"
    echo "$(date -u +%FT%TZ) $part $sha" >> "$releases/history.log"
  done
  rm -rf "$stage"
  log "release $sha serves: ${switched[*]}"
}

rollback() {
  local part="$1" target
  units_of "$part" >/dev/null
  [ -L "$releases/$part/previous" ] && [ -d "$(readlink -f "$releases/$part/previous")" ] ||
    die "$part has no previous release"
  target="$(sha_of_link "$releases/$part/previous")"
  point "$part" previous "$(readlink -f "$releases/$part/current")"
  log "$part: rolling back to $target"
  switch_to "$part" "$target" || die "$part is unhealthy after the rollback"
  echo "$(date -u +%FT%TZ) ROLLBACK $part $target" >> "$releases/history.log"
}

[ "$(id -u)" = 0 ] || die "run as root"
case "${1:-}" in
  deployed)
    [ $# = 2 ] || die "usage: idraft-activate deployed <backend|web>"
    units_of "$2" >/dev/null
    sha_of_link "$releases/$2/current"
    exit 0
    ;;
esac

# Everything a release does also lands in this log, which outlives the ssh session.
exec > >(tee -p -a /var/log/idraft-activate.log) 2>&1
exec 9>/run/idraft-activate.lock
flock -n 9 || die "another release is being activated"

case "${1:-}" in
  deploy) [ $# = 3 ] || die "usage: idraft-activate deploy <sha> <stage-dir>"; deploy "$2" "$3" ;;
  rollback) [ $# = 2 ] || die "usage: idraft-activate rollback <backend|web>"; rollback "$2" ;;
  *) die "usage: idraft-activate deploy <sha> <stage-dir> | rollback <backend|web> | deployed <backend|web>" ;;
esac

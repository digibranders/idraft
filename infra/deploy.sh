#!/usr/bin/env bash
# Deploy or roll back the idraft.ai production stack with Docker Compose.
# Usage:
#   infra/deploy.sh <env-file> <digests.json>
#   infra/deploy.sh --rollback <env-file>
#
# <env-file> is the live environment of the serving release (/etc/idraft/.env). A release is deployed
# with <env-file>.next when that file exists (written by idraft-install-env), otherwise with <env-file>.
# The candidate becomes <env-file> only after the release serves, and the env that served the old
# release is kept as <env-file>.previous, so a failed deploy and --rollback both restore an image
# set together with the env it was running on.
#
# Environment (all optional; production leaves them unset, tests set them):
#   IDRAFT_RELEASES_DIR  release records           default /srv/idraft/releases
#   IDRAFT_LOCK_FILE     deploy lock               default /run/idraft-deploy.lock
#   IDRAFT_ALLOW_TAGS    1 accepts name:tag images default 0 (digest references only)
#   IDRAFT_ACL_OWNER     owner of users.acl        default 999:999 (the redis image user); empty skips chown
#   IDRAFT_ACL_MODE      mode of users.acl         default 0600
# COMPOSE_PROJECT_NAME is honoured by Compose, which is how tests keep to their own project.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
compose_file="$here/compose/docker-compose.yml"
releases_dir="${IDRAFT_RELEASES_DIR:-/srv/idraft/releases}"
lock_file="${IDRAFT_LOCK_FILE:-/run/idraft-deploy.lock}"
allow_tags="${IDRAFT_ALLOW_TAGS:-0}"
acl_owner="${IDRAFT_ACL_OWNER-999:999}"
acl_mode="${IDRAFT_ACL_MODE:-0600}"

# idraft-ghcr-login stores the registry login here, and sudo does not promise a HOME.
if [ "$(id -u)" -eq 0 ]; then
  export DOCKER_CONFIG=/root/.docker
fi

env_file=""   # the env file Compose and env_get read right now
live_env=""   # env of the serving release
next_env=""   # staged candidate
prev_env=""   # env of the previous release
acl_rendered=0
api_image=""
worker_image=""
web_image=""
release_sha=""

die() {
  echo "$*" >&2
  exit 1
}

mkdir -p "$releases_dir" || die "Cannot create the releases directory $releases_dir."
previous_file="$releases_dir/previous.json"
current_file="$releases_dir/current.json"
history_log="$releases_dir/history.log"

# One deploy at a time. A missing flock is an error: running unlocked could interleave two deploys.
command -v flock >/dev/null 2>&1 || die "flock is required (apt install util-linux)."
exec 9>"$lock_file" || die "Cannot open the lock file $lock_file."
flock -n 9 || die "Another deploy is currently running."

dc() {
  docker compose -f "$compose_file" --env-file "$env_file" "$@"
}

# Reads KEY from the env file the way Compose does for an unquoted value. check_env_file has already
# refused quotes and inline comments, so no unquoting is needed here.
env_get() {
  local line
  line="$(grep -E "^$1=" "$env_file" | tail -n 1 || true)"
  printf '%s' "${line#*=}"
}

check_env_file() {
  [ -f "$env_file" ] || die "Environment file not found: $env_file"
  if grep -nE "^[A-Za-z_][A-Za-z0-9_]*=[\"']" "$env_file" >/dev/null; then
    die "$env_file has a quoted value. Write values without quotes (see infra/compose/.env.example)."
  fi
  if grep -nE "^[A-Za-z_][A-Za-z0-9_]*=.* #" "$env_file" >/dev/null; then
    die "$env_file has an inline comment. Put comments on their own line."
  fi
  # Compose interpolates $ in an env file, but the ACL hashes below use the raw value: they would differ.
  if grep -nE '^[A-Za-z_][A-Za-z0-9_]*=.*\$' "$env_file" >/dev/null; then
    die "$env_file has a value containing '\$'. Use alphanumeric or URL-safe secrets (openssl rand -hex 24)."
  fi
}

# copy_private <src> <dst>: an atomic 0600 copy, for env files.
copy_private() {
  local tmp
  tmp="$(umask 077 && mktemp "$2.XXXXXX")"
  cat "$1" > "$tmp"
  mv -f "$tmp" "$2"
}

# A staged env that was not promoted must not linger: a later manual deploy would silently pick it up.
discard_next_env() {
  if [ -f "$next_env" ]; then
    rm -f "$next_env"
    echo "Discarded the staged environment $next_env." >&2
  fi
}

# A release reference must be an immutable digest of our own image. Tags are test-only.
validate_image() {
  local role="$1" img="$2"
  [[ "$img" =~ ^ghcr\.io/digibranders/idraft-${role}@sha256:[0-9a-f]{64}$ ]] && return 0
  if [ "$allow_tags" = "1" ] && [[ "$img" =~ ^[A-Za-z0-9._/-]+:[A-Za-z0-9._-]+$ ]]; then
    return 0
  fi
  die "Refusing $role image '$img': it must match ghcr.io/digibranders/idraft-$role@sha256:<64 hex>."
}

# Loads a release record into api_image, worker_image, web_image and release_sha, validated.
read_release() {
  local file="$1"
  [ -f "$file" ] || die "Release file not found: $file"
  api_image="$(jq -r '.api // empty' "$file")" || die "Not valid JSON: $file"
  worker_image="$(jq -r '.worker // empty' "$file")" || die "Not valid JSON: $file"
  web_image="$(jq -r '.web // empty' "$file")" || die "Not valid JSON: $file"
  release_sha="$(jq -r '.sha // empty' "$file")" || die "Not valid JSON: $file"
  [ -n "$api_image" ] && [ -n "$worker_image" ] && [ -n "$web_image" ] \
    || die "Release file must define .api, .worker and .web: $file"
  validate_image api "$api_image"
  validate_image worker "$worker_image"
  validate_image web "$web_image"
  if [ -z "$release_sha" ]; then
    # No commit recorded: a short hash of the three references still names the release.
    release_sha="$(printf '%s\n%s\n%s\n' "$api_image" "$worker_image" "$web_image" | sha256sum | cut -c1-12)"
  fi
  [[ "$release_sha" =~ ^[0-9a-f]{12,40}$ ]] || die "Release sha must be 12 to 40 lowercase hex characters: $release_sha"
}

export_release() {
  export API_IMAGE="$api_image" WORKER_IMAGE="$worker_image" WEB_IMAGE="$web_image" RELEASE_SHA="$release_sha"
}

pull_image() {
  local img="$1"
  # Test images are built locally and exist in no registry.
  if [ "$allow_tags" = "1" ] && docker image inspect "$img" >/dev/null 2>&1; then
    return 0
  fi
  docker pull "$img"
}

require_env() {
  local value
  value="$(env_get "$1")"
  [ -n "$value" ] || die "$1 is not set in $env_file; refusing to deploy without it."
  printf '%s' "$value"
}

# Renders users.acl (SHA-256 hashes only) into REDIS_ACL_DIR and makes a running Redis load it.
# The directory is mounted into the container, so the rename below is visible there.
render_redis_acl() {
  local acl_dir app_pass health_pass admin_pass app_hash health_hash admin_hash tmp
  # Callers run this in an || list, where set -e is off: every step reports failure itself.
  acl_dir="$(require_env REDIS_ACL_DIR)" || return 1
  app_pass="$(require_env REDIS_PASSWORD_APP)" || return 1
  health_pass="$(require_env REDIS_PASSWORD_HEALTHCHECK)" || return 1
  admin_pass="$(require_env REDIS_PASSWORD_ADMIN)" || return 1
  app_hash="$(printf '%s' "$app_pass" | sha256sum | cut -d' ' -f1)"
  health_hash="$(printf '%s' "$health_pass" | sha256sum | cut -d' ' -f1)"
  admin_hash="$(printf '%s' "$admin_pass" | sha256sum | cut -d' ' -f1)"

  mkdir -p "$acl_dir" || return 1
  # Traversable, because the mount shows this mode inside the container; the file is what is private.
  chmod 0711 "$acl_dir" || return 1
  tmp="$(umask 077 && mktemp "$acl_dir/.users.acl.XXXXXX")" || return 1
  printf '%s\n' \
    "user default off" \
    "user app on #${app_hash} resetkeys ~collect ~process ~taskiq:* ~dedupe:* ~cache:* ~rl:* ~lock:* ~sess:* ~oauth:* resetchannels +@all -@dangerous +info +client|setname +client|getname" \
    "user healthcheck on #${health_hash} resetkeys resetchannels -@all +ping" \
    "user admin on #${admin_hash} ~* &* +@all" > "$tmp" || return 1
  chmod "$acl_mode" "$tmp" || return 1
  if [ -n "$acl_owner" ]; then
    chown "$acl_owner" "$tmp" || return 1
  fi
  mv -f "$tmp" "$acl_dir/users.acl" || return 1
  acl_rendered=1

  local redis_cid
  redis_cid="$(dc ps -q redis || true)"
  if [ -n "$redis_cid" ] && [ "$(docker inspect -f '{{.State.Running}}' "$redis_cid")" = "true" ]; then
    echo "Reloading the Redis ACL..."
    # The password reaches docker through the environment, never as an argument.
    if REDISCLI_AUTH="$admin_pass" dc exec -T -e REDISCLI_AUTH redis redis-cli --no-auth-warning --user admin ACL LOAD | grep -qx OK; then
      # Recreates Redis only if its own settings changed (the healthcheck password is part of them).
      dc up -d redis >/dev/null || return 1
    else
      # The running Redis may still hold the old admin password (a rotation), so read the file on a fresh start.
      echo "ACL LOAD was refused; recreating Redis to read the new file." >&2
      dc up -d --force-recreate redis >/dev/null || return 1
    fi
    wait_for_service redis 90 || return 1
  fi
}

# Prints "<state>|<health>" for a service, "missing|none" if it has no container.
service_state() {
  local cid
  cid="$(dc ps -aq "$1" | head -n 1 || true)"
  if [ -z "$cid" ]; then
    echo "missing|none"
    return 0
  fi
  docker inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid"
}

# 0 when running and healthy, 1 on a failure state, 2 while still starting.
service_verdict() {
  local state health
  IFS='|' read -r state health <<<"$(service_state "$1")"
  case "$state" in
    exited | dead | restarting | missing) return 1 ;;
  esac
  case "$health" in
    unhealthy) return 1 ;;
    healthy | none) [ "$state" = "running" ] && return 0 ;;
  esac
  return 2
}

wait_for_service() {
  local svc="$1" timeout="${2:-60}" start verdict
  start="$(date +%s)"
  echo "Waiting for $svc to become healthy..."
  while true; do
    verdict=0
    service_verdict "$svc" || verdict=$?
    case "$verdict" in
      0) return 0 ;;
      1)
        echo "$svc entered a failure state: $(service_state "$svc")" >&2
        return 1
        ;;
    esac
    if [ $(($(date +%s) - start)) -ge "$timeout" ]; then
      echo "Timed out waiting for $svc (state: $(service_state "$svc"))." >&2
      return 1
    fi
    sleep 2
  done
}

wait_for_health() {
  local svc
  for svc in api worker web caddy; do
    wait_for_service "$svc" 60 || return 1
  done
  echo "All application services are healthy."
}

# Asks the stack through Caddy, the way a user's browser does, with the name Caddy serves.
expect_status() {
  local path="$1" want="$2" domain port got deadline
  domain="$(env_get DOMAIN)"
  domain="${domain:-app.idraft.ai}"
  port="$(env_get HTTPS_PORT)"
  port="${port:-443}"
  deadline=$(($(date +%s) + 60))
  while true; do
    # -k: Caddy may still be obtaining its certificate, and the check is about routing, not trust.
    got="$(curl -ksS -o /dev/null -w '%{http_code}' --max-time 5 \
      --resolve "$domain:$port:127.0.0.1" "https://$domain:$port$path" 2>/dev/null || true)"
    if [ "$got" = "$want" ]; then
      echo "Edge check $path: $got."
      return 0
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "Edge check $path returned $got, expected $want." >&2
      return 1
    fi
    sleep 2
  done
}

probe_edge() {
  # An unauthenticated call must reach the API and be refused; readyz proves the API reaches its stores.
  expect_status /api/v1/me 401 && expect_status /api/readyz 200
}

# Brings the services back on a release record and the env file that release ran on, and checks they
# serve. Returns 1 on any failure.
restore_release() {
  local file="$1" envf="$2" svc
  if [ ! -f "$envf" ]; then
    echo "The environment file of that release is missing: $envf" >&2
    return 1
  fi
  env_file="$envf"
  check_env_file
  read_release "$file"
  export_release
  render_redis_acl >&2 || return 1
  for svc in api worker web caddy; do
    dc up -d "$svc" >&2 || return 1
  done
  wait_for_health && probe_edge
}
log_history() {
  echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") $*" >> "$history_log"
}

# A deploy that failed before it touched an application container. The candidate env is dropped, and
# the Redis ACL, which may already be rendered from it, goes back to the serving release's env.
abort_deploy() {
  local failed="api=$api_image worker=$worker_image web=$web_image"
  echo "$1" >&2
  discard_next_env
  if [ "$acl_rendered" = 1 ] && [ -f "$current_file" ] && [ -f "$live_env" ]; then
    echo "Restoring the Redis ACL of the release that is serving." >&2
    env_file="$live_env"
    render_redis_acl >&2 || echo "The previous Redis ACL could not be restored. Intervene on the host." >&2
  fi
  log_history "DEPLOY_FAILED $failed"
  exit 1
}

# A deploy that failed after application containers were replaced. The failed release is never
# recorded; the release that was serving (current.json) comes back on its own env.
fail_deploy() {
  local failed="api=$api_image worker=$worker_image web=$web_image"
  echo "$1" >&2
  discard_next_env
  if [ -f "$current_file" ]; then
    echo "Restoring the release that was serving:" >&2
    if ! restore_release "$current_file" "$live_env"; then
      echo "RECOVERY FAILED: the previous release did not come back healthy. Intervene on the host." >&2
    fi
  else
    # Nothing to go back to: do not leave a half-started release answering. Postgres and Redis stay up.
    dc stop api worker web caddy >&2 || true
    echo "First deploy failed and there is no earlier release. The application containers were stopped; postgres and redis were left running. Fix the cause and deploy again." >&2
  fi
  log_history "DEPLOY_FAILED $failed"
  exit 1
}

run_rollback() {
  [ -f "$previous_file" ] || die "Nothing to roll back: no previous release is recorded at $previous_file."
  [ -f "$prev_env" ] || die "Nothing to roll back: the environment of the previous release ($prev_env) is missing."
  echo "Rolling back to the previous release and its environment..."
  discard_next_env
  if ! restore_release "$previous_file" "$prev_env"; then
    echo "The previous release did not come back healthy. Restoring the release that was serving." >&2
    if [ -f "$current_file" ] && restore_release "$current_file" "$live_env"; then
      die "Rollback failed its health checks; the release that was serving was restored."
    fi
    die "RECOVERY FAILED: neither release came back healthy. Intervene on the host."
  fi
  cp "$previous_file" "$current_file.tmp"
  mv -f "$current_file.tmp" "$current_file"
  copy_private "$prev_env" "$live_env"
  log_history "ROLLBACK api=$api_image worker=$worker_image web=$web_image"
  echo "Rollback completed successfully."
}

if [ "${1:-}" = "--rollback" ]; then
  [ "$#" -eq 2 ] || die "Usage: $0 --rollback <env-file> (the env file is required, there is no default)"
  live_env="$2"
  next_env="$live_env.next"
  prev_env="$live_env.previous"
  run_rollback
  exit 0
fi

[ "$#" -eq 2 ] || die "Usage: $0 <env-file> <digests.json>
       $0 --rollback <env-file>"
live_env="$1"
next_env="$live_env.next"
prev_env="$live_env.previous"
if [ -f "$next_env" ]; then
  env_file="$next_env"
  echo "Deploying with the staged environment $next_env."
else
  env_file="$live_env"
  echo "No staged environment; deploying with $live_env."
fi
check_env_file
read_release "$2"

echo "Starting deployment of release $release_sha:"
echo "  API:    $api_image"
echo "  Worker: $worker_image"
echo "  Web:    $web_image"

export_release
# Catches a missing required variable before anything running is touched.
dc config -q || die "The environment does not render the Compose file. Nothing was changed."

# Nothing running has been touched yet, so a failure up to the migration needs no recovery.
echo "Pulling images..."
for img in "$api_image" "$worker_image" "$web_image"; do
  pull_image "$img" || abort_deploy "Failed to pull $img. Nothing was changed."
done

render_redis_acl || abort_deploy "Could not load the new Redis ACL."

echo "Running database migrations..."
dc run --rm migrator || abort_deploy "Database migration failed. The application services were not touched."

echo "Deploying application containers in order..."
for svc in api worker web caddy; do
  echo "Starting service $svc..."
  dc up -d "$svc" || fail_deploy "Failed to start $svc."
  wait_for_service "$svc" 60 || fail_deploy "Service $svc failed its health check."
done

probe_edge || fail_deploy "The edge check through Caddy failed."

# Record the release only now that it serves; the old one becomes the rollback target.
if [ -f "$current_file" ]; then
  cp "$current_file" "$previous_file"
  # The env the old release ran on belongs to the rollback target.
  if [ -f "$live_env" ]; then
    copy_private "$live_env" "$prev_env"
  fi
fi
if [ "$env_file" = "$next_env" ]; then
  mv -f "$next_env" "$live_env"
fi
# Rewritten from the validated values, not copied from the staged file.
jq -n --arg api "$api_image" --arg worker "$worker_image" --arg web "$web_image" --arg sha "$release_sha" \
  '{api: $api, worker: $worker, web: $web, sha: $sha}' > "$current_file.tmp"
mv -f "$current_file.tmp" "$current_file"
log_history "DEPLOY sha=$release_sha api=$api_image worker=$worker_image web=$web_image"

echo "Deploy completed successfully."

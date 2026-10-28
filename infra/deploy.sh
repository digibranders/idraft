#!/usr/bin/env bash
# Deploy or rollback idraft.ai production stack using Docker Compose.
# Usage:
#   infra/deploy.sh <env-file> <digests.json>
#   infra/deploy.sh --rollback [<env-file>]
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
compose_file="$here/compose/docker-compose.yml"
releases_dir="${IDRAFT_RELEASES_DIR:-/srv/idraft/releases}"

# Fall back to a local temporary directory if /srv/idraft/releases is not writable.
if ! mkdir -p "$releases_dir" 2>/dev/null; then
  releases_dir="/tmp/idraft-releases"
  mkdir -p "$releases_dir"
fi

previous_file="$releases_dir/previous.json"
current_file="$releases_dir/current.json"
history_log="$releases_dir/history.log"
lock_file="/tmp/idraft-deploy.lock"

# Acquire exclusive deploy lock to prevent concurrent runs.
if command -v flock >/dev/null 2>&1; then
  exec 9>"$lock_file"
  if ! flock -n 9; then
    echo "Another deploy is currently running." >&2
    exit 1
  fi
elif command -v shlock >/dev/null 2>&1; then
  if ! shlock -p "$$" -f "$lock_file"; then
    echo "Another deploy is currently running." >&2
    exit 1
  fi
  trap 'rm -f "$lock_file"' EXIT
fi

render_redis_acl() {
  local env_f="$1"
  local acl_path=""
  acl_path="$(grep '^REDIS_ACL_FILE=' "$env_f" | cut -d= -f2- || true)"
  if [ -z "$acl_path" ]; then
    acl_path="$here/compose/redis/users.acl"
  fi

  local app_pass health_pass admin_pass
  app_pass="$(grep '^REDIS_PASSWORD_APP=' "$env_f" | cut -d= -f2- || true)"
  health_pass="$(grep '^REDIS_PASSWORD_HEALTHCHECK=' "$env_f" | cut -d= -f2- || true)"
  admin_pass="$(grep '^REDIS_PASSWORD_ADMIN=' "$env_f" | cut -d= -f2- || true)"

  if [ -n "$app_pass" ] && [ -n "$health_pass" ] && [ -n "$admin_pass" ]; then
    local app_hash health_hash admin_hash
    app_hash="$(printf '%s' "$app_pass" | sha256sum | awk '{print $1}')"
    health_hash="$(printf '%s' "$health_pass" | sha256sum | awk '{print $1}')"
    admin_hash="$(printf '%s' "$admin_pass" | sha256sum | awk '{print $1}')"

    mkdir -p "$(dirname "$acl_path")"
    cat > "$acl_path" <<ACL
user default off
user app on #${app_hash} resetkeys ~collect ~process ~taskiq:* ~dedupe:* ~cache:* ~rl:* ~lock:* ~sess:* ~oauth:* resetchannels +@all -@dangerous +info +client|setname +client|getname
user healthcheck on #${health_hash} resetkeys resetchannels -@all +ping
user admin on #${admin_hash} ~* &* +@all
ACL
  fi
}

pull_image() {
  local img="$1"
  if [ "${IDRAFT_SKIP_PULL:-0}" = "1" ]; then
    return 0
  fi
  # If local tag without slash or digest, check if it already exists locally.
  if [[ "$img" != *"/"* ]] && [[ "$img" != *"@"* ]]; then
    if docker image inspect "$img" >/dev/null 2>&1; then
      return 0
    fi
  fi
  docker pull "$img"
}

wait_for_service() {
  local svc="$1"
  local timeout="${2:-60}"
  local start_time
  start_time="$(date +%s)"
  local container="idraft-$svc"
  echo "Waiting for $container to become healthy..."

  while true; do
    local status
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || echo "missing")"
    if [ "$status" = "healthy" ] || [ "$status" = "running" ]; then
      return 0
    fi
    if [ "$status" = "unhealthy" ] || [ "$status" = "exited" ] || [ "$status" = "dead" ]; then
      echo "$container entered failure state: $status" >&2
      return 1
    fi
    local now
    now="$(date +%s)"
    if [ $((now - start_time)) -ge "$timeout" ]; then
      echo "Timed out waiting for $container (status: $status)." >&2
      return 1
    fi
    sleep 2
  done
}

wait_for_health() {
  local timeout=60
  local start_time
  start_time="$(date +%s)"
  echo "Waiting for services to become healthy (timeout ${timeout}s)..."

  while true; do
    local all_healthy=true
    for svc in api worker web caddy; do
      local container="idraft-$svc"
      local status
      status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || echo "missing")"
      if [ "$status" != "healthy" ] && [ "$status" != "running" ]; then
        all_healthy=false
        break
      fi
    done

    if [ "$all_healthy" = true ]; then
      echo "All application services are healthy."
      return 0
    fi

    local now
    now="$(date +%s)"
    if [ $((now - start_time)) -ge "$timeout" ]; then
      echo "Timed out waiting for services to become healthy." >&2
      return 1
    fi
    sleep 2
  done
}

run_rollback() {
  local env_f="$1"
  echo "Rolling back to previous release..." >&2

  if [ ! -f "$previous_file" ]; then
    echo "No previous release recorded at $previous_file to roll back to." >&2
    exit 1
  fi

  local prev_api prev_worker prev_web
  prev_api="$(jq -r '.api // empty' "$previous_file")"
  prev_worker="$(jq -r '.worker // empty' "$previous_file")"
  prev_web="$(jq -r '.web // empty' "$previous_file")"

  if [ -z "$prev_api" ] || [ -z "$prev_worker" ] || [ -z "$prev_web" ]; then
    echo "Invalid previous release file format: $previous_file" >&2
    exit 1
  fi

  echo "Restoring images from previous release:" >&2
  echo "  API:    $prev_api" >&2
  echo "  Worker: $prev_worker" >&2
  echo "  Web:    $prev_web" >&2

  export API_IMAGE="$prev_api"
  export WORKER_IMAGE="$prev_worker"
  export WEB_IMAGE="$prev_web"

  for svc in api worker web caddy; do
    docker compose -f "$compose_file" --env-file "$env_f" up -d "$svc" >&2
  done

  if ! wait_for_health; then
    echo "Rollback failed health checks!" >&2
    exit 1
  fi

  cp "$previous_file" "$current_file"

  local ts
  ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "$ts ROLLBACK api=$prev_api worker=$prev_worker web=$prev_web" >> "$history_log"
  echo "Rollback completed successfully."
}

# Handle explicit rollback flag.
if [ "${1:-}" = "--rollback" ]; then
  shift
  env_file="${1:-}"
  if [ -z "$env_file" ]; then
    if [ -f "/etc/idraft/.env" ]; then
      env_file="/etc/idraft/.env"
    else
      env_file="$here/compose/.env.example"
    fi
  fi
  run_rollback "$env_file"
  exit 0
fi

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <env-file> <digests.json>" >&2
  echo "       $0 --rollback [<env-file>]" >&2
  exit 1
fi

env_file="$1"
digests_file="$2"

if [ ! -f "$env_file" ]; then
  echo "Environment file not found: $env_file" >&2
  exit 1
fi

if [ ! -f "$digests_file" ]; then
  echo "Digests file not found: $digests_file" >&2
  exit 1
fi

api_image="$(jq -r '.api // empty' "$digests_file")"
worker_image="$(jq -r '.worker // empty' "$digests_file")"
web_image="$(jq -r '.web // empty' "$digests_file")"

if [ -z "$api_image" ] || [ -z "$worker_image" ] || [ -z "$web_image" ]; then
  echo "Digests file must define .api, .worker and .web: $digests_file" >&2
  exit 1
fi

echo "Starting deployment of:"
echo "  API:    $api_image"
echo "  Worker: $worker_image"
echo "  Web:    $web_image"

# Pull all three images by digest.
echo "Pulling images..."
if ! pull_image "$api_image" || ! pull_image "$worker_image" || ! pull_image "$web_image"; then
  echo "Failed to pull one or more images." >&2
  if [ -f "$previous_file" ]; then
    run_rollback "$env_file" || true
  fi
  exit 1
fi

# Render Redis ACL file if credentials are configured.
render_redis_acl "$env_file"

# Run database migrations as one-off migrator before updating long-running containers.
echo "Running database migrations..."
export API_IMAGE="$api_image"
export WORKER_IMAGE="$worker_image"
export WEB_IMAGE="$web_image"

if ! docker compose -f "$compose_file" --env-file "$env_file" run --rm migrator; then
  echo "Database migration failed. Aborting deployment before touching app services." >&2
  exit 1
fi

# If a current release is active, record it as previous before deploying new containers.
if [ -f "$current_file" ]; then
  cp "$current_file" "$previous_file"
fi

# Deploy application containers in order: api, worker, web, caddy.
echo "Deploying application containers in order..."
for svc in api worker web caddy; do
  echo "Starting service $svc..."
  if ! docker compose -f "$compose_file" --env-file "$env_file" up -d "$svc"; then
    echo "Failed to start $svc! Triggering automatic rollback..." >&2
    if [ -f "$previous_file" ]; then
      run_rollback "$env_file" || true
    fi
    exit 1
  fi
  if ! wait_for_service "$svc"; then
    echo "Service $svc failed health checks! Triggering automatic rollback..." >&2
    if [ -f "$previous_file" ]; then
      run_rollback "$env_file" || true
    fi
    exit 1
  fi
done

# Step 4: Verify internal readiness probe on API.
echo "Verifying readiness probe on API..."
if ! docker exec idraft-api python -c "import urllib.request, sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/readyz').status == 200 else 1)"; then
  echo "API readiness probe failed! Triggering automatic rollback..." >&2
  if [ -f "$previous_file" ]; then
    run_rollback "$env_file" || true
  fi
  exit 1
fi

# Update current release and append to history log.
cp "$digests_file" "$current_file"
ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "$ts DEPLOY api=$api_image worker=$worker_image web=$web_image" >> "$history_log"

echo "Deploy completed successfully."

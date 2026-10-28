#!/usr/bin/env bash
# Runs built images the way production does: PostgreSQL initialised by the role script, migrations
# as migrator with only DATABASE_URL, the API as app_api (/api/readyz must answer 200), and the
# worker as app_worker (its heartbeat must be fresh, and SIGTERM must stop it with code 0).
# Usage:
#   backend/smoke.sh
#   backend/smoke.sh <image>
#   backend/smoke.sh <api-image> <worker-image> <migrator-image>
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
initdb="$here/../infra/compose/postgres/initdb"
network="idraft-smoke-$$"
host="smoke-postgres:5432/idraft"

role="all"
api_image=""
worker_image=""
migrator_image=""

if [ "$#" -eq 0 ]; then
  echo "No image provided. Building local target images for api, worker and migrator..."
  docker build -q --target api -t idraft-api:smoke "$here" >/dev/null
  docker build -q --target worker -t idraft-worker:smoke "$here" >/dev/null
  docker build -q --target migrator -t idraft-migrator:smoke "$here" >/dev/null
  api_image="idraft-api:smoke"
  worker_image="idraft-worker:smoke"
  migrator_image="idraft-migrator:smoke"
elif [ "$#" -eq 1 ]; then
  target_image="$1"
  # Inspect PROCESS_ROLE or CMD to check if a specific target was provided.
  env_role="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$target_image" 2>/dev/null | grep '^PROCESS_ROLE=' | cut -d= -f2 || true)"
  cmd_str="$(docker inspect -f '{{.Config.Cmd}}' "$target_image" 2>/dev/null || true)"
  if [ "$env_role" = "migrator" ] || [[ "$cmd_str" == *"idraft.db.migrate"* ]] || [[ "$target_image" == *"migrator"* ]]; then
    role="migrator"
    migrator_image="$target_image"
  elif [ "$env_role" = "worker" ] || [[ "$cmd_str" == *"idraft.worker"* ]] || [[ "$target_image" == *"worker"* ]]; then
    role="worker"
    worker_image="$target_image"
    migrator_image="$target_image"
  elif [ "$env_role" = "api" ] || [[ "$cmd_str" == *"uvicorn"* ]] || [[ "$target_image" == *"api"* ]]; then
    role="api"
    api_image="$target_image"
    migrator_image="$target_image"
  else
    role="all"
    api_image="$target_image"
    worker_image="$target_image"
    migrator_image="$target_image"
  fi
elif [ "$#" -ge 3 ]; then
  role="all"
  api_image="$1"
  worker_image="$2"
  migrator_image="$3"
else
  echo "usage: smoke.sh [<image> | <api-image> <worker-image> <migrator-image>]" >&2
  exit 1
fi

cleanup() {
  docker rm -f smoke-api smoke-worker smoke-postgres smoke-redis >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Starting smoke test for role: $role"
docker network create "$network" >/dev/null
docker run -d --name smoke-postgres --network "$network" \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres-smoke -e POSTGRES_DB=idraft \
  -e PG_MIGRATOR_PASSWORD=migrator-smoke -e PG_API_PASSWORD=api-smoke \
  -e PG_WORKER_PASSWORD=worker-smoke \
  -v "$initdb:/docker-entrypoint-initdb.d:ro" \
  postgres:18 postgres -c shared_preload_libraries=pg_stat_statements >/dev/null

if [ "$role" != "migrator" ]; then
  docker run -d --name smoke-redis --network "$network" redis:8 >/dev/null
fi

# The role script has finished once app_api can log in.
for _ in $(seq 1 60); do
  docker exec -e PGPASSWORD=api-smoke smoke-postgres \
    psql -h 127.0.0.1 -U app_api -d idraft -c 'SELECT 1' >/dev/null 2>&1 && break
  sleep 1
done

# Run migrator with only DATABASE_URL.
echo "Running migrator..."
if [ "$role" = "migrator" ] || [ "$role" = "all" ]; then
  docker run --rm --network "$network" \
    -e DATABASE_URL="postgresql://migrator:migrator-smoke@$host" \
    "$migrator_image"
else
  docker run --rm --network "$network" \
    -e DATABASE_URL="postgresql://migrator:migrator-smoke@$host" \
    "$migrator_image" python -m idraft.db.migrate
fi

if [ "$role" = "migrator" ]; then
  echo "migrator: successfully ran migrations"
  exit 0
fi

if [ "$role" = "api" ] || [ "$role" = "all" ]; then
  echo "Starting API..."
  totp_key="$(head -c 32 /dev/urandom | base64)"
  if [ "$role" = "api" ] || [ "$role" = "all" ]; then
    docker run -d --name smoke-api --network "$network" -p 127.0.0.1:18080:8000 \
      -e APP_ORIGIN=http://localhost:3000 \
      -e TOTP_ENCRYPTION_KEY="$totp_key" \
      -e DATABASE_URL="postgresql://app_api:api-smoke@$host" \
      -e REDIS_URL=redis://smoke-redis:6379/0 "$api_image" >/dev/null
  fi

  ready=""
  for _ in $(seq 1 30); do
    if body="$(curl -fsS http://127.0.0.1:18080/api/readyz 2>/dev/null)"; then
      echo "readyz: $body"
      ready=yes
      break
    fi
    sleep 1
  done
  if [ -z "$ready" ]; then
    echo "the API never became ready" >&2
    docker logs smoke-api >&2 || true
    exit 1
  fi
  [ "$(docker exec smoke-api id -u)" = "10001" ] || { echo "image does not run as uid 10001"; exit 1; }
  echo "api: readyz 200, running as uid 10001"
fi

if [ "$role" = "api" ]; then
  exit 0
fi

if [ "$role" = "worker" ] || [ "$role" = "all" ]; then
  echo "Starting worker..."
  docker run -d --name smoke-worker --network "$network" \
    -e PROCESS_ROLE=worker -e APP_ORIGIN=http://localhost:3000 \
    -e DATABASE_URL="postgresql://app_worker:worker-smoke@$host" \
    -e REDIS_URL=redis://smoke-redis:6379/0 -e HEARTBEAT_FILE=/tmp/heartbeat \
    "$worker_image" >/dev/null

  healthy=""
  for _ in $(seq 1 30); do
    if docker exec smoke-worker python -m idraft.worker.healthcheck /tmp/heartbeat 30 2>/dev/null; then
      healthy=yes
      break
    fi
    sleep 1
  done
  if [ -z "$healthy" ]; then
    echo "the worker never wrote a fresh heartbeat" >&2
    docker logs smoke-worker >&2 || true
    exit 1
  fi
  [ "$(docker exec smoke-worker id -u)" = "10001" ] || { echo "the worker does not run as uid 10001"; exit 1; }

  # A deploy stops it with SIGTERM: it must end by itself, cleanly, inside the grace period.
  docker stop --time 30 smoke-worker >/dev/null
  code="$(docker inspect -f '{{.State.ExitCode}}' smoke-worker)"
  if [ "$code" != "0" ]; then
    echo "the worker exited with $code on SIGTERM" >&2
    docker logs smoke-worker >&2 || true
    exit 1
  fi
  echo "worker: healthy, stopped cleanly"
fi

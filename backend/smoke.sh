#!/usr/bin/env bash
# Runs a built image the way production does: PostgreSQL initialised by the role script, migrations
# as `migrator` with only DATABASE_URL, the API as `app_api` (/api/readyz must answer 200), and the
# worker as `app_worker` (its heartbeat must be fresh, and SIGTERM must stop it with code 0).
# Usage: backend/smoke.sh <image>
set -euo pipefail

image="${1:?usage: smoke.sh <image>}"
here="$(cd "$(dirname "$0")" && pwd)"
initdb="$here/../infra/compose/postgres/initdb"
network="sightline-smoke-$$"
host="smoke-postgres:5432/sightline"

cleanup() {
  docker rm -f smoke-api smoke-worker smoke-postgres smoke-redis >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$network" >/dev/null
docker run -d --name smoke-postgres --network "$network" \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres-smoke -e POSTGRES_DB=sightline \
  -e PG_MIGRATOR_PASSWORD=migrator-smoke -e PG_API_PASSWORD=api-smoke \
  -e PG_WORKER_PASSWORD=worker-smoke \
  -v "$initdb:/docker-entrypoint-initdb.d:ro" \
  postgres:18 postgres -c shared_preload_libraries=pg_stat_statements >/dev/null
docker run -d --name smoke-redis --network "$network" redis:8 >/dev/null

# The role script has finished once app_api can log in.
for _ in $(seq 1 60); do
  docker exec -e PGPASSWORD=api-smoke smoke-postgres \
    psql -h 127.0.0.1 -U app_api -d sightline -c 'SELECT 1' >/dev/null 2>&1 && break
  sleep 1
done

docker run --rm --network "$network" \
  -e DATABASE_URL="postgresql://migrator:migrator-smoke@$host" \
  "$image" python -m sightline.db.migrate

docker run -d --name smoke-api --network "$network" -p 127.0.0.1:18080:8000 \
  -e APP_ORIGIN=http://localhost:3000 \
  -e TOTP_ENCRYPTION_KEY="$(head -c 32 /dev/urandom | base64)" \
  -e DATABASE_URL="postgresql://app_api:api-smoke@$host" \
  -e REDIS_URL=redis://smoke-redis:6379/0 "$image" >/dev/null

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

# The worker, as app_worker, with the healthcheck the container runs.
docker run -d --name smoke-worker --network "$network" \
  -e PROCESS_ROLE=worker -e APP_ORIGIN=http://localhost:3000 \
  -e DATABASE_URL="postgresql://app_worker:worker-smoke@$host" \
  -e REDIS_URL=redis://smoke-redis:6379/0 -e HEARTBEAT_FILE=/tmp/heartbeat \
  "$image" python -m sightline.worker >/dev/null

healthy=""
for _ in $(seq 1 30); do
  if docker exec smoke-worker python -m sightline.worker.healthcheck /tmp/heartbeat 30 2>/dev/null; then
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

# A deploy stops it with SIGTERM: it must end by itself, cleanly, well inside the grace period.
docker stop --time 30 smoke-worker >/dev/null
code="$(docker inspect -f '{{.State.ExitCode}}' smoke-worker)"
if [ "$code" != "0" ]; then
  echo "the worker exited with $code on SIGTERM" >&2
  docker logs smoke-worker >&2 || true
  exit 1
fi
echo "worker: healthy, stopped cleanly"

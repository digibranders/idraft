#!/usr/bin/env bash
# Runs a built image the way production does: migrate with only DATABASE_URL, start the API, and
# require /api/readyz to answer 200. Usage: backend/smoke.sh <image>
set -euo pipefail

image="${1:?usage: smoke.sh <image>}"
network="sightline-smoke-$$"
database_url="postgresql://sightline:sightline@smoke-postgres:5432/sightline"

cleanup() {
  docker rm -f smoke-api smoke-postgres smoke-redis >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$network" >/dev/null
docker run -d --name smoke-postgres --network "$network" \
  -e POSTGRES_USER=sightline -e POSTGRES_PASSWORD=sightline -e POSTGRES_DB=sightline \
  postgres:18 >/dev/null
docker run -d --name smoke-redis --network "$network" redis:8 >/dev/null

for _ in $(seq 1 30); do
  docker exec smoke-postgres pg_isready -U sightline -d sightline >/dev/null 2>&1 && break
  sleep 1
done

docker run --rm --network "$network" -e DATABASE_URL="$database_url" \
  "$image" python -m sightline.db.migrate

docker run -d --name smoke-api --network "$network" -p 127.0.0.1:18080:8000 \
  -e APP_ORIGIN=http://localhost:3000 -e DATABASE_URL="$database_url" \
  -e REDIS_URL=redis://smoke-redis:6379/0 "$image" >/dev/null

for _ in $(seq 1 30); do
  if body="$(curl -fsS http://127.0.0.1:18080/api/readyz 2>/dev/null)"; then
    echo "readyz: $body"
    [ "$(docker exec smoke-api id -u)" = "10001" ] || { echo "image does not run as uid 10001"; exit 1; }
    exit 0
  fi
  sleep 1
done

echo "the API never became ready" >&2
docker logs smoke-api >&2 || true
exit 1

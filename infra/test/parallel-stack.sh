#!/usr/bin/env bash
# Proves two complete stacks can run at once: the same compose file under two project names, on
# different host ports and subnets, deployed by deploy.sh. Needs the idraft-*:local images.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=infra/test/lib.sh
source "$here/lib.sh"

test_dir="$(make_test_dir)"
export_test_deploy_env "$test_dir"
write_digests "$test_dir/v1.json" idraft-api:local idraft-worker:local idraft-web:local

# <project> <http-port> <https-port> <edge-subnet> <backend-subnet>
projects=("idraft-par-a 28080 28443 172.31.20.0/24 172.31.10.0/24" "idraft-par-b 38080 38443 172.32.20.0/24 172.32.10.0/24")

cleanup() {
  echo "Tearing down both stacks..."
  for spec in "${projects[@]}"; do
    read -r name _ <<<"$spec"
    COMPOSE_PROJECT_NAME="$name" docker compose -f "$compose_file" --env-file "$test_dir/$name.env" \
      down -v --remove-orphans >/dev/null 2>&1 || true
  done
  rm -rf "$test_dir"
}
trap cleanup EXIT

for spec in "${projects[@]}"; do
  read -r name http https edge backend <<<"$spec"
  write_test_env "$test_dir/$name.env" "$test_dir/$name-redis" "$http" "$https" "$edge" "$backend"
  echo "=== Deploying project $name on port $https ==="
  COMPOSE_PROJECT_NAME="$name" IDRAFT_RELEASES_DIR="$test_dir/$name-releases" IDRAFT_LOCK_FILE="$test_dir/$name.lock" \
    IDRAFT_REDIS_ACL_DIR="$test_dir/$name-redis" "$deploy_sh" "$test_dir/$name.env" "$test_dir/v1.json"
done

echo "=== Both stacks up: each serves on its own port ==="
for spec in "${projects[@]}"; do
  read -r name _ https _ _ <<<"$spec"
  assert_eq "$(edge_status "$https" /api/v1/me)" 401 "$name /api/v1/me"
  assert_eq "$(edge_status "$https" /api/readyz)" 200 "$name /api/readyz"
done

ids_a="$(docker ps -q --filter label=com.docker.compose.project=idraft-par-a | sort)"
ids_b="$(docker ps -q --filter label=com.docker.compose.project=idraft-par-b | sort)"
[ -n "$ids_a" ] && [ -n "$ids_b" ] || fail "a project has no containers"
[ -z "$(comm -12 <(echo "$ids_a") <(echo "$ids_b"))" ] || fail "the projects share a container"
echo "project a: $(echo "$ids_a" | wc -l | tr -d ' ') containers, project b: $(echo "$ids_b" | wc -l | tr -d ' ') containers"
docker ps --filter label=com.docker.compose.project --format '{{.Names}}\t{{.Ports}}' | grep -E 'idraft-par' | sort
echo "Parallel stack test passed."

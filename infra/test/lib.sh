#!/usr/bin/env bash
# Shared helpers for the local stack tests. Sourced, never run. Requires docker, jq, curl.
# The tests use throwaway passwords and locally built images, and never touch a stack outside their
# own COMPOSE_PROJECT_NAME. They run under the bash 3.2 that macOS ships, so no large heredocs (they
# deadlock there) and no bash 4 features.

# shellcheck disable=SC2034  # the sourcing scripts use these variables
infra_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_dir="$(cd "$infra_dir/.." && pwd)"
compose_file="$infra_dir/compose/docker-compose.yml"
deploy_sh="$infra_dir/deploy.sh"

# A scratch directory the Docker VM can see (Colima shares $HOME, not $TMPDIR), since Redis mounts
# its ACL directory from it.
make_test_dir() {
  local base="${IDRAFT_TEST_TMPDIR:-$HOME/.cache}"
  mkdir -p "$base"
  mktemp -d "$base/idraft-test.XXXXXX"
}

# write_test_env <file> <acl-dir> <http-port> <https-port> <edge-subnet> <backend-subnet>
# Fills env.template; the values in it are throwaway.
write_test_env() {
  local file="$1" line
  : > "$file"
  while IFS= read -r line; do
    line="${line//@ACL_DIR@/$2}"
    line="${line//@HTTP_PORT@/$3}"
    line="${line//@HTTPS_PORT@/$4}"
    line="${line//@EDGE_SUBNET@/$5}"
    line="${line//@BACKEND_SUBNET@/$6}"
    printf '%s\n' "$line" >> "$file"
  done < "$infra_dir/test/env.template"
}

# Environment deploy.sh needs when it runs on a laptop instead of the production host.
export_test_deploy_env() {
  local dir="$1"
  export IDRAFT_ALLOW_TAGS=1 IDRAFT_ACL_OWNER="" IDRAFT_ACL_MODE=0644
  export IDRAFT_RELEASES_DIR="$dir/releases" IDRAFT_LOCK_FILE="$dir/deploy.lock"
  mkdir -p "$IDRAFT_RELEASES_DIR"
  # macOS has no flock. The shim only lets the script start; the lock itself is exercised on Linux.
  if ! command -v flock >/dev/null 2>&1; then
    mkdir -p "$dir/bin"
    printf '#!/bin/sh\nexit 0\n' > "$dir/bin/flock"
    chmod +x "$dir/bin/flock"
    export PATH="$dir/bin:$PATH"
  fi
}

# build_variant_images: v2 images that differ from the local ones, plus two deliberately broken api images.
# shellcheck disable=SC2016  # the $ in the Dockerfile text must reach the Dockerfile unexpanded
build_variant_images() {
  local role
  for role in api worker web; do
    printf 'FROM idraft-%s:local\nLABEL idraft.release=v2\n' "$role" | docker build -q -t "idraft-$role:v2" - >/dev/null
  done
  # Starts for the migrator (command python ...) but exits for the server (command uvicorn ...).
  printf 'FROM idraft-api:local\nENTRYPOINT ["/bin/sh","-c","if [ \\"$1\\" = uvicorn ]; then exit 1; fi; exec \\"$@\\"","--"]\n' \
    | docker build -q -t idraft-api:badcmd - >/dev/null
  # Pulls and starts fine, but its migration exits non-zero.
  printf 'FROM idraft-api:local\nUSER root\nRUN f="$(python -c "import idraft.db.migrate as m; print(m.__file__)")" && printf "import sys\\nsys.exit(3)\\n" > "$f"\nUSER 10001:10001\n' \
    | docker build -q -t idraft-api:badmig - >/dev/null
}

remove_variant_images() {
  docker rmi -f idraft-api:v2 idraft-worker:v2 idraft-web:v2 idraft-api:badcmd idraft-api:badmig >/dev/null 2>&1 || true
}

# write_digests <file> <api> <worker> <web> [sha]
write_digests() {
  if [ "$#" -ge 5 ]; then
    jq -n --arg api "$2" --arg worker "$3" --arg web "$4" --arg sha "$5" '{api:$api,worker:$worker,web:$web,sha:$sha}' > "$1"
  else
    jq -n --arg api "$2" --arg worker "$3" --arg web "$4" '{api:$api,worker:$worker,web:$web}' > "$1"
  fi
}

# edge_status <https-port> <path>: HTTP status through Caddy, 000 when unreachable.
edge_status() {
  curl -ksS -o /dev/null -w '%{http_code}' --max-time 5 \
    --resolve "localhost:$1:127.0.0.1" "https://localhost:$1$2" 2>/dev/null || true
}

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_eq() {
  [ "$1" = "$2" ] || fail "$3 (got '$1', expected '$2')"
}

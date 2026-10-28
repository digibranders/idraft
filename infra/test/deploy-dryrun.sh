#!/usr/bin/env bash
# Runs infra/deploy.sh against a real Compose stack on this machine, in its own Compose project and on
# non-default ports, and checks what a failed deploy leaves behind. Needs the idraft-{api,worker,web}:local
# images (build them with backend/smoke.sh and the web Dockerfile) and throws everything else away.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=infra/test/lib.sh
source "$here/lib.sh"

export COMPOSE_PROJECT_NAME=idraft-dryrun
https_port=18443
test_dir="$(make_test_dir)"
env_file="$test_dir/env.test"
acl_dir="$test_dir/redis"
export_test_deploy_env "$test_dir"
write_test_env "$env_file" "$acl_dir" 18080 "$https_port" 172.30.20.0/24 172.30.10.0/24

dc() {
  docker compose -f "$compose_file" --env-file "$env_file" "$@"
}

cleanup() {
  echo "Cleaning up the dry-run stack and files..."
  dc down -v --remove-orphans >/dev/null 2>&1 || true
  remove_variant_images
  rm -rf "$test_dir"
}
trap cleanup EXIT

last_rc=0
# run_deploy <args...>: runs deploy.sh, shows its output, keeps it in $test_dir/last.log, sets last_rc.
run_deploy() {
  set +e
  "$deploy_sh" "$@" > "$test_dir/last.log" 2>&1
  last_rc=$?
  set -e
  cat "$test_dir/last.log"
}

container_id() { dc ps -q "$1"; }
image_of() { docker inspect -f '{{.Config.Image}}' "$(container_id "$1")"; }
state_of() { docker inspect -f '{{.State.Status}}|{{.State.Health.Status}}' "$(container_id "$1")"; }
ids() { for s in api worker web caddy; do container_id "$s"; done; }
# A fingerprint of the working tree under the paths the run could write to. A run must not change it.
repo_state() { { git -C "$repo_dir" status --porcelain -- infra backend .github; git -C "$repo_dir" diff -- infra backend .github; } | shasum -a 256; }
repo_before="$(repo_state)"

assert_serving() {
  assert_eq "$(edge_status "$https_port" /api/v1/me)" 401 "$1: /api/v1/me through Caddy"
  assert_eq "$(edge_status "$https_port" /api/readyz)" 200 "$1: /api/readyz through Caddy"
  assert_eq "$(edge_status "$https_port" /api/internal/x)" 404 "$1: /api/internal is not public"
  for s in api worker web caddy; do
    assert_eq "$(state_of "$s")" "running|healthy" "$1: $s state"
  done
}

# Everything a failed deploy must leave alone.
snapshot() {
  { ids; cat "$IDRAFT_RELEASES_DIR/current.json" "$IDRAFT_RELEASES_DIR/previous.json" 2>/dev/null || true; } | shasum -a 256
}

sha_v2=1234567890abcdef1234567890abcdef12345678

echo "=== 1. Building the v2 and the deliberately broken images ==="
build_variant_images
write_digests "$test_dir/v1.json" idraft-api:local idraft-worker:local idraft-web:local
write_digests "$test_dir/v2.json" idraft-api:v2 idraft-worker:v2 idraft-web:v2 "$sha_v2"

echo "=== 2. First deploy (v1, no commit recorded, so the release id is derived) ==="
run_deploy "$env_file" "$test_dir/v1.json"
assert_eq "$last_rc" 0 "v1 deploy exit code"
assert_eq "$(image_of api)" idraft-api:local "v1 api image"
assert_eq "$(image_of worker)" idraft-worker:local "v1 worker image"
assert_eq "$(image_of web)" idraft-web:local "v1 web image"
[ -f "$IDRAFT_RELEASES_DIR/current.json" ] || fail "current.json was not written"
[ ! -f "$IDRAFT_RELEASES_DIR/previous.json" ] || fail "previous.json exists after the first deploy"
v1_sha="$(jq -r .sha "$IDRAFT_RELEASES_DIR/current.json")"
[[ "$v1_sha" =~ ^[0-9a-f]{12}$ ]] || fail "derived release id is '$v1_sha'"
assert_serving "v1"

echo "=== 3. Second deploy (v2 differs from v1, records previous, reloads the Redis ACL) ==="
run_deploy "$env_file" "$test_dir/v2.json"
assert_eq "$last_rc" 0 "v2 deploy exit code"
grep -q "Reloading the Redis ACL" "$test_dir/last.log" || fail "a running Redis was not told to reload its ACL"
assert_eq "$(image_of api)" idraft-api:v2 "v2 api image"
assert_eq "$(image_of worker)" idraft-worker:v2 "v2 worker image"
assert_eq "$(image_of web)" idraft-web:v2 "v2 web image"
assert_eq "$(jq -r .api "$IDRAFT_RELEASES_DIR/previous.json")" idraft-api:local "previous.json api"
assert_eq "$(jq -r .api "$IDRAFT_RELEASES_DIR/current.json")" idraft-api:v2 "current.json api"
assert_eq "$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$(container_id api)" | grep '^RELEASE_SHA=')" \
  "RELEASE_SHA=$sha_v2" "RELEASE_SHA reaches the api container"
assert_serving "v2"

echo "=== 4. The rendered Redis ACL holds hashes only and the repository is untouched ==="
grep -q '^user default off$' "$acl_dir/users.acl" || fail "users.acl does not disable the default user"
if grep -qE 'redis-(app|healthcheck|admin)-local' "$acl_dir/users.acl"; then
  fail "users.acl contains a plaintext password"
fi
assert_eq "$(repo_state)" "$repo_before" "repository working tree after the deploys"

echo "=== 5. Refusals that must change nothing ==="
before="$(snapshot)"

echo "--- a tag is refused unless IDRAFT_ALLOW_TAGS=1 ---"
IDRAFT_ALLOW_TAGS=0 run_deploy "$env_file" "$test_dir/v1.json"
[ "$last_rc" -ne 0 ] || fail "a tag reference was accepted without IDRAFT_ALLOW_TAGS"
grep -q "must match" "$test_dir/last.log" || fail "the refusal does not say why"
assert_eq "$(snapshot)" "$before" "state after a refused tag"

echo "--- a quoted value in the env file is refused ---"
sed 's/^DOMAIN=.*/DOMAIN="localhost"/' "$env_file" > "$test_dir/env.quoted"
run_deploy "$test_dir/env.quoted" "$test_dir/v1.json"
[ "$last_rc" -ne 0 ] || fail "a quoted env value was accepted"
assert_eq "$(snapshot)" "$before" "state after a quoted env"

echo "--- a missing Redis password fails the deploy, it does not skip the ACL ---"
grep -v '^REDIS_PASSWORD_ADMIN=' "$env_file" > "$test_dir/env.noadmin"
run_deploy "$test_dir/env.noadmin" "$test_dir/v1.json"
[ "$last_rc" -ne 0 ] || fail "a deploy ran without REDIS_PASSWORD_ADMIN"
grep -q "REDIS_PASSWORD_ADMIN is not set" "$test_dir/last.log" || fail "the missing password is not named"
assert_eq "$(snapshot)" "$before" "state after a missing password"

echo "--- a digest that does not exist: the pull fails before anything is touched ---"
write_digests "$test_dir/nopull.json" idraft-api:v2 idraft-worker:v2 \
  "ghcr.io/digibranders/idraft-web@sha256:0000000000000000000000000000000000000000000000000000000000000000"
run_deploy "$env_file" "$test_dir/nopull.json"
[ "$last_rc" -ne 0 ] || fail "a deploy of a missing digest exited 0"
assert_eq "$(snapshot)" "$before" "state after a failed pull"
assert_serving "after the failed pull"

echo "=== 6. The new api container fails its health gate: the serving release is restored ==="
write_digests "$test_dir/badcmd.json" idraft-api:badcmd idraft-worker:v2 idraft-web:v2
before="$(snapshot)"
cp "$IDRAFT_RELEASES_DIR/current.json" "$test_dir/current.before"
cp "$IDRAFT_RELEASES_DIR/previous.json" "$test_dir/previous.before"
run_deploy "$env_file" "$test_dir/badcmd.json"
[ "$last_rc" -ne 0 ] || fail "a deploy whose api exits returned 0"
grep -q "Restoring the release that was serving" "$test_dir/last.log" || fail "no restore was attempted"
assert_eq "$(image_of api)" idraft-api:v2 "api image after the failed health gate"
assert_eq "$(image_of worker)" idraft-worker:v2 "worker image after the failed health gate"
assert_eq "$(image_of web)" idraft-web:v2 "web image after the failed health gate"
cmp "$IDRAFT_RELEASES_DIR/current.json" "$test_dir/current.before" || fail "current.json changed"
cmp "$IDRAFT_RELEASES_DIR/previous.json" "$test_dir/previous.before" || fail "previous.json changed"
assert_serving "after the failed health gate"
tail -n 1 "$IDRAFT_RELEASES_DIR/history.log" | grep -q DEPLOY_FAILED || fail "the failure is not in history.log"

echo "=== 7. The migration fails: no application container is touched ==="
write_digests "$test_dir/badmig.json" idraft-api:badmig idraft-worker:v2 idraft-web:v2
before_ids="$(ids)"
before="$(snapshot)"
run_deploy "$env_file" "$test_dir/badmig.json"
[ "$last_rc" -ne 0 ] || fail "a deploy whose migration fails returned 0"
grep -q "Database migration failed" "$test_dir/last.log" || fail "the migration failure is not reported"
assert_eq "$(ids)" "$before_ids" "container ids after a failed migration"
assert_eq "$(snapshot)" "$before" "state after a failed migration"
assert_eq "$(image_of api)" idraft-api:v2 "api image after a failed migration"
assert_serving "after the failed migration"

echo "=== 8. Manual rollback ==="
run_deploy --rollback
[ "$last_rc" -ne 0 ] || fail "--rollback without an env file succeeded"
run_deploy --rollback "$test_dir/missing.env"
[ "$last_rc" -ne 0 ] || fail "--rollback with a missing env file succeeded"
run_deploy --rollback "$env_file"
assert_eq "$last_rc" 0 "rollback exit code"
assert_eq "$(image_of api)" idraft-api:local "api image after rollback"
assert_eq "$(image_of worker)" idraft-worker:local "worker image after rollback"
assert_eq "$(image_of web)" idraft-web:local "web image after rollback"
assert_eq "$(jq -r .api "$IDRAFT_RELEASES_DIR/current.json")" idraft-api:local "current.json after rollback"
assert_serving "after rollback"

assert_eq "$(repo_state)" "$repo_before" "repository working tree at the end"
echo "Deploy dry-run tests passed successfully."

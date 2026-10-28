#!/usr/bin/env bash
# Offline test of infra/ci/resolve-release.sh. gh and docker are replaced by infra/test/fake, which
# answer from JSON fixtures shaped like the real GitHub API responses, so no network, token or Docker
# daemon is needed. Runs against the real workflow files, so it also pins how the path filters of
# backend.yml (inline list) and web.yml (block list) are read.
#
# Not covered: the real gh, the real registry and GitHub's path filter semantics (the script treats
# * as matching / too, which can only make it skip or fail more often, never deploy a stale release).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
infra_dir="$(cd "$here/.." && pwd)"
repo_dir="$(cd "$infra_dir/.." && pwd)"
script="$infra_dir/ci/resolve-release.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
export FIXTURES="$work/fixtures"
export PATH="$here/fake:$PATH"
export GH_TOKEN=test-token REPO=digibranders/idraft WORKFLOWS_DIR="$repo_dir/.github/workflows"
api_prefix="repos_digibranders_idraft"

sha_a="$(printf '%040d' 0 | tr 0 a)" # an older commit
sha_b="$(printf '%040d' 0 | tr 0 b)" # the commit being released
sha_c="$(printf '%040d' 0 | tr 0 c)" # a newer tip of main
ref() { printf 'ghcr.io/digibranders/idraft-%s@sha256:%s' "$1" "$(printf '%064d' 0 | tr 0 "$2")"; }

put() { # <relative-file> <content>
  mkdir -p "$(dirname "$FIXTURES/$1")"
  printf '%s\n' "$2" > "$FIXTURES/$1"
}
tip() { put "api/${api_prefix}_commits_main.json" "{\"sha\":\"$1\"}"; }
compare() { # <base> <head> <status> [file...]
  local base="$1" head="$2" status="$3" files="" f
  shift 3
  for f in "$@"; do files="$files{\"filename\":\"$f\"},"; done
  put "api/${api_prefix}_compare_$base...$head.json" "{\"status\":\"$status\",\"files\":[${files%,}]}"
}
runs() { put "runs/$1-$2.json" "$3"; } # <workflow> <commit|latest> <json>
artifact() { # <run-id> <name> <file> <json>: a live artifact and its content
  put "api/${api_prefix}_actions_runs_$1_artifacts.json" "{\"artifacts\":[{\"name\":\"$2\",\"expired\":false}]}"
  put "artifacts/$1-$2/$3" "$4"
}
image() { put "images/$(printf '%s' "$1" | tr '/@:' '___').json" "$2"; } # <reference> <config json>
labelled() { printf '{"config":{"Labels":{"org.opencontainers.image.revision":"%s"}}}' "$1"; }

# fresh <triggering-workflow>: everything a push of sha_b needs, both workflows succeeded for it.
fresh() {
  rm -rf "$FIXTURES"
  mkdir -p "$FIXTURES"
  tip "$sha_b"
  runs backend.yml commit '[{"databaseId":100,"status":"completed","conclusion":"success"}]'
  runs web.yml commit '[{"databaseId":200,"status":"completed","conclusion":"success"}]'
  artifact 100 backend-digests backend-digests.json "{\"api\":\"$(ref api 1)\",\"worker\":\"$(ref worker 2)\"}"
  artifact 200 web-digests web-digests.json "{\"web\":\"$(ref web 3)\"}"
}

rc=0
out=""
# resolve <mode-env...>: runs the script with a fresh output file, sets rc, out, and $work/skip.
resolve() {
  rm -f "$work/digests.json" "$work/github-output"
  : > "$work/github-output"
  set +e
  out="$(env OUT="$work/digests.json" GITHUB_OUTPUT="$work/github-output" "$@" bash "$script" 2>&1)"
  rc=$?
  set -e
}
as_backend_run() { resolve MODE=run SHA="$sha_b" RUN_ID=100 RUN_NAME=backend; }
as_web_run() { resolve MODE=run SHA="$sha_b" RUN_ID=200 RUN_NAME=web; }

expect_record() { # <name>
  [ "$rc" -eq 0 ] || fail "$1: exit $rc: $out"
  [ ! -s "$work/github-output" ] || fail "$1: unexpected skip"
  jq -e --arg sha "${2:-$sha_b}" --arg api "$(ref api 1)" --arg web "$(ref web 3)" \
    '.api == $api and .web == $web and .sha == $sha' "$work/digests.json" >/dev/null || fail "$1: wrong record: $(cat "$work/digests.json")"
  echo "ok: $1"
}
expect_skip() { # <name>
  [ "$rc" -eq 0 ] || fail "$1: exit $rc: $out"
  grep -qx 'skip=true' "$work/github-output" || fail "$1: did not skip: $out"
  [ ! -f "$work/digests.json" ] || fail "$1: wrote a record while skipping"
  echo "ok: $1"
}
expect_fail() { # <name> <message fragment>
  [ "$rc" -ne 0 ] || fail "$1: exited 0: $out"
  [[ "$out" == *"$2"* ]] || fail "$1: message lacks '$2': $out"
  echo "ok: $1"
}

echo "=== workflow_run mode ==="
fresh
as_backend_run
expect_record "both workflows succeeded for the commit (backend triggered)"
as_web_run
expect_record "both workflows succeeded for the commit (web triggered)"

fresh
compare "$sha_b" "$sha_c" ahead docs/readme.md infra/deploy.sh
tip "$sha_c"
as_backend_run
expect_record "main moved on, but only docs and infra changed"

for changed in backend/src/app.py .github/workflows/backend.yml apps/web/src/a.ts pnpm-lock.yaml backend/openapi/v1.json .github/workflows/web.yml; do
  fresh
  tip "$sha_c"
  compare "$sha_b" "$sha_c" ahead docs/readme.md "$changed"
  as_backend_run
  expect_skip "main moved on and $changed changed"
done

fresh
tip "$sha_c"
compare "$sha_b" "$sha_c" ahead
as_backend_run
expect_record "main moved on with an empty diff"

echo "=== sibling fallback ==="
fresh
runs web.yml commit '[]'
runs web.yml latest "[{\"databaseId\":200,\"headSha\":\"$sha_a\"}]"
compare "$sha_a" "$sha_b" ahead docs/readme.md backend/src/app.py
as_backend_run
expect_record "web did not run, nothing it watches changed"

fresh
runs web.yml commit '[]'
runs web.yml latest "[{\"databaseId\":200,\"headSha\":\"$sha_a\"}]"
compare "$sha_a" "$sha_b" ahead docs/readme.md apps/web/src/a.ts
as_backend_run
expect_fail "web did not run although apps/web changed" "has no run for $sha_b"

fresh
runs web.yml commit '[]'
runs web.yml latest "[{\"databaseId\":200,\"headSha\":\"$sha_a\"}]"
compare "$sha_a" "$sha_b" diverged
as_backend_run
expect_fail "the sibling run is not an ancestor" "not an ancestor"

fresh
runs web.yml commit '[]'
runs web.yml latest '[]'
as_backend_run
expect_fail "the sibling never succeeded" "no successful web.yml run"

echo "=== sibling state for the commit ==="
fresh
runs web.yml commit '[{"databaseId":200,"status":"in_progress","conclusion":null}]'
as_backend_run
expect_skip "the sibling is still running"

fresh
runs web.yml commit '[{"databaseId":200,"status":"completed","conclusion":"cancelled"}]'
as_backend_run
expect_skip "the sibling was cancelled"

fresh
runs web.yml commit '[{"databaseId":200,"status":"completed","conclusion":"failure"}]'
as_backend_run
expect_fail "the sibling failed" "did not succeed"

fresh
runs web.yml commit '[{"databaseId":199,"status":"completed","conclusion":"failure"},{"databaseId":200,"status":"completed","conclusion":"success"}]'
as_backend_run
expect_record "a re-run of the sibling succeeded after a failure"

echo "=== artifacts ==="
fresh
put "api/${api_prefix}_actions_runs_200_artifacts.json" '{"artifacts":[{"name":"web-digests","expired":true}]}'
as_backend_run
expect_fail "an expired artifact" "missing or has expired"

fresh
put "api/${api_prefix}_actions_runs_200_artifacts.json" '{"artifacts":[]}'
as_backend_run
expect_fail "a missing artifact" "missing or has expired"

fresh
artifact 200 web-digests web-digests.json "{\"web\":\"ghcr.io/digibranders/idraft-web:latest\"}"
as_backend_run
expect_fail "a tag instead of a digest" "not made of digest references"

echo "=== dispatch mode ==="
dispatch() { # <api commit> <worker commit> <web commit>
  fresh
  image "$(ref api 1)" "$(labelled "$1")"
  image "$(ref worker 2)" "$(labelled "$2")"
  image "$(ref web 3)" "$(labelled "$3")"
  resolve MODE=dispatch INPUT_API="$(ref api 1)" INPUT_WORKER="$(ref worker 2)" INPUT_WEB="$(ref web 3)"
}
dispatch "$sha_b" "$sha_b" "$sha_b"
expect_record "images built from one commit record that commit"

dispatch "$sha_a" "$sha_a" "$sha_b"
compare "$sha_b" "$sha_a" behind
compare "$sha_a" "$sha_b" ahead
resolve MODE=dispatch INPUT_API="$(ref api 1)" INPUT_WORKER="$(ref worker 2)" INPUT_WEB="$(ref web 3)"
expect_record "images from two commits on one line record the newest" "$sha_b"

dispatch "$sha_a" "$sha_a" "$sha_b"
compare "$sha_b" "$sha_a" diverged
compare "$sha_a" "$sha_b" diverged
resolve MODE=dispatch INPUT_API="$(ref api 1)" INPUT_WORKER="$(ref worker 2)" INPUT_WEB="$(ref web 3)"
expect_fail "images from diverging commits" "not on one line of history"

dispatch "$sha_b" "$sha_b" "$sha_b"
image "$(ref worker 2)" '{"config":{"Labels":{}}}'
resolve MODE=dispatch INPUT_API="$(ref api 1)" INPUT_WORKER="$(ref worker 2)" INPUT_WEB="$(ref web 3)"
expect_fail "an image without a revision label" "no org.opencontainers.image.revision label"

dispatch "$sha_b" "$sha_b" "$sha_b"
resolve MODE=dispatch INPUT_API="$(ref api 1)" INPUT_WORKER="$(ref worker 2)" INPUT_WEB=""
expect_fail "a missing reference" "needs all three image references"

dispatch "$sha_b" "$sha_b" "$sha_b"
resolve MODE=dispatch INPUT_API="ghcr.io/digibranders/idraft-api:latest" INPUT_WORKER="$(ref worker 2)" INPUT_WEB="$(ref web 3)"
expect_fail "an unknown image is refused" "cannot read"

echo "Offline resolve-release tests passed."

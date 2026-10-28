#!/usr/bin/env bash
# Builds the release record (digests.json) the deploy workflow ships, and refuses anything that is not
# an immutable digest of our own images. Runs in GitHub Actions; needs gh, jq and GH_TOKEN.
#
# Inputs (environment):
#   OUT        file to write the record to
#   REPO       owner/name of this repository
#   SHA        commit being released
#   MODE       dispatch: INPUT_API, INPUT_WORKER and INPUT_WEB hold the references
#              run:      RUN_ID and RUN_NAME describe the workflow_run that triggered the deploy
#                        (backend or web); the other workflow's digests are looked up for SHA
# When the sibling workflow is still running for SHA, the script writes skip=true to GITHUB_OUTPUT and
# exits 0: that workflow's own completion triggers a deploy of the same commit.
set -euo pipefail

die() {
  echo "resolve-release: $*" >&2
  exit 1
}

: "${OUT:?}" "${REPO:?}" "${SHA:?}" "${MODE:?}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# download <run-id> <artifact> <file>: prints the path of the artifact file; a failure is fatal.
download() {
  local dir="$work/$1-$2"
  mkdir -p "$dir"
  gh run download "$1" --repo "$REPO" --name "$2" --dir "$dir" >&2 || die "cannot download artifact $2 of run $1"
  [ -f "$dir/$3" ] || die "artifact $2 of run $1 has no $3"
  printf '%s' "$dir/$3"
}

# sibling_run <workflow-file>: prints the run id whose digests belong to SHA, or "pending".
sibling_run() {
  local wf="$1" runs id sha status
  runs="$(gh run list --repo "$REPO" --workflow "$wf" --branch main --event push --commit "$SHA" \
    --json databaseId,status,conclusion --limit 20)"
  id="$(jq -r '[.[] | select(.conclusion == "success")][0].databaseId // empty' <<<"$runs")"
  if [ -n "$id" ]; then
    echo "$id"
    return 0
  fi
  if [ "$(jq 'length' <<<"$runs")" -gt 0 ]; then
    # It ran for this commit and has not succeeded: wait if it is running, fail if it failed.
    jq -e 'any(.[]; .status != "completed")' >/dev/null <<<"$runs" || die "$wf did not succeed for $SHA"
    echo pending
    return 0
  fi
  # Path filters kept it from running for this commit, so its inputs did not change: take its newest
  # successful run on main, provided that commit is at or behind SHA.
  read -r id sha <<<"$(gh run list --repo "$REPO" --workflow "$wf" --branch main --event push --status success \
    --json databaseId,headSha --limit 1 --jq '.[0] | "\(.databaseId) \(.headSha)"')"
  [ -n "$id" ] && [ "$id" != "null" ] || die "no successful $wf run exists on main"
  status="$(gh api "repos/$REPO/compare/$sha...$SHA" --jq .status)"
  case "$status" in
    ahead | identical) echo "$id" ;;
    *) die "the newest successful $wf run ($sha) is not an ancestor of $SHA (compare: $status)" ;;
  esac
}

api="" worker="" web=""
case "$MODE" in
  dispatch)
    api="${INPUT_API:-}"
    worker="${INPUT_WORKER:-}"
    web="${INPUT_WEB:-}"
    [ -n "$api" ] && [ -n "$worker" ] && [ -n "$web" ] || die "a manual deploy needs all three image references"
    ;;
  run)
    : "${RUN_ID:?}" "${RUN_NAME:?}" "${GH_TOKEN:?}"
    case "$RUN_NAME" in
      backend)
        backend_run="$RUN_ID"
        web_run="$(sibling_run web.yml)"
        ;;
      web)
        web_run="$RUN_ID"
        backend_run="$(sibling_run backend.yml)"
        ;;
      *) die "unexpected triggering workflow: $RUN_NAME" ;;
    esac
    if [ "$backend_run" = pending ] || [ "$web_run" = pending ]; then
      echo "The sibling workflow is still running for $SHA; its completion will trigger the deploy."
      if [ -n "${GITHUB_OUTPUT:-}" ]; then
        echo "skip=true" >> "$GITHUB_OUTPUT"
      fi
      exit 0
    fi
    backend_file="$(download "$backend_run" backend-digests backend-digests.json)"
    web_file="$(download "$web_run" web-digests web-digests.json)"
    api="$(jq -r '.api // empty' "$backend_file")"
    worker="$(jq -r '.worker // empty' "$backend_file")"
    web="$(jq -r '.web // empty' "$web_file")"
    ;;
  *) die "MODE must be dispatch or run" ;;
esac

jq -n --arg api "$api" --arg worker "$worker" --arg web "$web" --arg sha "$SHA" \
  '{api: $api, worker: $worker, web: $web, sha: $sha}' > "$OUT"

# The same rule deploy.sh enforces on the host.
jq -e '
  (.api    | test("^ghcr\\.io/digibranders/idraft-api@sha256:[0-9a-f]{64}$")) and
  (.worker | test("^ghcr\\.io/digibranders/idraft-worker@sha256:[0-9a-f]{64}$")) and
  (.web    | test("^ghcr\\.io/digibranders/idraft-web@sha256:[0-9a-f]{64}$")) and
  (.sha    | test("^[0-9a-f]{40}$"))
' "$OUT" >/dev/null || die "the release record is not made of digest references: $(cat "$OUT")"

echo "Release record for $SHA:"
cat "$OUT"

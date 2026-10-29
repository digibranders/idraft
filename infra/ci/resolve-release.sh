#!/usr/bin/env bash
# Builds the release record (digests.json) the deploy workflow ships, and refuses anything that is not
# an immutable digest of our own images or that would mix commits or go backwards.
# Runs in GitHub Actions; needs gh, jq, awk and GH_TOKEN (dispatch mode also needs docker, logged in to ghcr.io).
#
# Inputs (environment):
#   OUT        file to write the record to
#   REPO       owner/name of this repository
#   MODE       dispatch: INPUT_API, INPUT_WORKER and INPUT_WEB hold the references; the release commit
#                        is read from the org.opencontainers.image.revision label of the images
#              run:      SHA, RUN_ID and RUN_NAME describe the workflow_run that triggered the deploy
#                        (backend or web); the other workflow's digests are looked up for SHA
#   WORKFLOWS_DIR  where the workflow files are (default .github/workflows); tests point it elsewhere
#
# The script writes skip=true to GITHUB_OUTPUT and exits 0 when this run must not deploy:
#   - the other workflow is still running for SHA, or was cancelled (its completion, or the newer
#     run that cancelled it, triggers a deploy);
#   - main has moved on to a commit that changes what a workflow builds, so SHA would be a step backwards.
set -euo pipefail

die() {
  echo "resolve-release: $*" >&2
  exit 1
}

skip() {
  echo "$*"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "skip=true" >> "$GITHUB_OUTPUT"
  fi
  exit 0
}

: "${OUT:?}" "${REPO:?}" "${MODE:?}" "${GH_TOKEN:?}"
workflows_dir="${WORKFLOWS_DIR:-.github/workflows}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# push_paths <workflow-file>: the on.push.paths patterns, one per line. Handles the inline list
# (paths: ["a", "b"]) and the block list the two workflows use; infra/test/resolve-release.sh pins both.
push_paths() {
  awk '
    function emit(s) {
      gsub(/^[ \t]+|[ \t]+$/, "", s)
      gsub("^[\"" q "]|[\"" q "]$", "", s)
      if (s != "") print s
    }
    BEGIN { q = sprintf("%c", 39) }
    /^on:/ { on = 1; next }
    /^[^ #]/ { on = 0; push = 0; paths = 0 }
    on && /^  [A-Za-z_]+:/ { push = ($1 == "push:"); paths = 0; next }
    push && /^    [A-Za-z_]+:/ {
      paths = ($1 == "paths:")
      if (paths && $0 ~ /\[/) {
        line = $0
        sub(/^[^[]*\[/, "", line)
        sub(/\].*$/, "", line)
        n = split(line, parts, ",")
        for (i = 1; i <= n; i++) emit(parts[i])
        paths = 0
      }
      next
    }
    push && paths && /^      - / { line = $0; sub(/^      - /, "", line); emit(line) }
  ' "$1"
}

# touches_images <base> <head> <workflow>...: prints the first file changed between the two commits that
# matches a push path filter of one of the workflows, or nothing. Fails (and so ends the script) if the
# comparison cannot be made.
touches_images() {
  local base="$1" head="$2" files wf pattern file
  shift 2
  files="$(gh api "repos/$REPO/compare/$base...$head" --paginate --jq '.files[].filename')" \
    || die "cannot compare $base with $head"
  for wf in "$@"; do
    [ -f "$workflows_dir/$wf" ] || die "workflow file $workflows_dir/$wf not found"
    while IFS= read -r pattern; do
      [ -n "$pattern" ] || continue
      while IFS= read -r file; do
        # The pattern is meant to glob. In case, * also crosses /, which errs on the safe side.
        # shellcheck disable=SC2254
        case "$file" in $pattern)
          echo "$file ($wf)"
          return 0
          ;;
        esac
      done <<<"$files"
    done <<<"$(push_paths "$workflows_dir/$wf")"
  done
  return 0
}

# download <run-id> <artifact> <file>: prints the path of the artifact file; a failure is fatal.
download() {
  local run="$1" name="$2" file="$3" live dir="$work/$1-$2"
  live="$(gh api "repos/$REPO/actions/runs/$run/artifacts" \
    --jq "[.artifacts[] | select(.name == \"$name\" and (.expired | not))] | length")" \
    || die "cannot list the artifacts of run $run"
  [ "$live" -gt 0 ] || die "artifact $name of run $run is missing or has expired. Re-run that workflow on main, or deploy manually with explicit image references."
  mkdir -p "$dir"
  gh run download "$run" --repo "$REPO" --name "$name" --dir "$dir" >&2 || die "cannot download artifact $name of run $run"
  [ -f "$dir/$file" ] || die "artifact $name of run $run has no $file"
  printf '%s' "$dir/$file"
}

# sibling_run <workflow-file>: prints the run id whose digests belong to SHA, or "pending" (still
# running) or "cancelled" (cancelled by a newer run).
sibling_run() {
  local wf="$1" runs id sha status hit
  runs="$(gh run list --repo "$REPO" --workflow "$wf" --branch main --event push --commit "$SHA" \
    --json databaseId,status,conclusion --limit 20)" || die "cannot list the runs of $wf"
  id="$(jq -r '[.[] | select(.conclusion == "success")][0].databaseId // empty' <<<"$runs")"
  if [ -n "$id" ]; then
    echo "$id"
    return 0
  fi
  if [ "$(jq 'length' <<<"$runs")" -gt 0 ]; then
    # It ran for this commit and has not succeeded: wait if it is running, stand down if it was
    # cancelled, fail if it failed.
    if jq -e 'any(.[]; .status != "completed")' >/dev/null <<<"$runs"; then
      echo pending
    elif jq -e 'all(.[]; .conclusion == "cancelled")' >/dev/null <<<"$runs"; then
      echo cancelled
    else
      die "$wf did not succeed for $SHA"
    fi
    return 0
  fi
  # No run for this commit. That is right only if the path filters kept it from running: its newest
  # successful run on main is taken, provided that commit is behind SHA and nothing the workflow
  # watches changed since.
  runs="$(gh run list --repo "$REPO" --workflow "$wf" --branch main --event push --status success \
    --json databaseId,headSha --limit 1)" || die "cannot list the runs of $wf"
  id="$(jq -r '.[0].databaseId // empty' <<<"$runs")"
  sha="$(jq -r '.[0].headSha // empty' <<<"$runs")"
  [ -n "$id" ] || die "no successful $wf run exists on main"
  status="$(gh api "repos/$REPO/compare/$sha...$SHA" --jq .status)" || die "cannot compare $sha with $SHA"
  case "$status" in
    ahead | identical) ;;
    *) die "the newest successful $wf run ($sha) is not an ancestor of $SHA (compare: $status)" ;;
  esac
  hit="$(touches_images "$sha" "$SHA" "$wf")"
  [ -z "$hit" ] || die "$wf has no run for $SHA although $hit changed since its last run at $sha"
  echo "$id"
}

# image_commit <reference>: the commit an image was built from, read from its registry config.
image_commit() {
  local cfg commit
  cfg="$(docker buildx imagetools inspect "$1" --format '{{json .Image}}')" \
    || die "cannot read $1 from the registry (is docker logged in to ghcr.io?)"
  commit="$(jq -r 'if has("config") then . else to_entries[0].value end | .config.Labels["org.opencontainers.image.revision"] // empty' <<<"$cfg")"
  [[ "$commit" =~ ^[0-9a-f]{40}$ ]] \
    || die "$1 has no org.opencontainers.image.revision label with a commit (built before labelling, or not built by CI)"
  printf '%s' "$commit"
}

# newest_commit <sha>...: the commit every other one is an ancestor of. Images from diverging
# commits are not one release.
newest_commit() {
  local cand other status ok
  for cand in "$@"; do
    ok=1
    for other in "$@"; do
      [ "$other" != "$cand" ] || continue
      status="$(gh api "repos/$REPO/compare/$other...$cand" --jq .status)" || die "cannot compare $other with $cand"
      case "$status" in
        ahead | identical) ;;
        *)
          ok=0
          break
          ;;
      esac
    done
    if [ "$ok" = 1 ]; then
      printf '%s' "$cand"
      return 0
    fi
  done
  die "the images were built from commits that are not on one line of history: $*"
}

api="" worker="" web="" release_sha=""
case "$MODE" in
  dispatch)
    api="${INPUT_API:-}"
    worker="${INPUT_WORKER:-}"
    web="${INPUT_WEB:-}"
    [ -n "$api" ] && [ -n "$worker" ] && [ -n "$web" ] || die "a manual deploy needs all three image references"
    # Separate assignments: a failure inside an argument's command substitution would not stop the script.
    api_commit="$(image_commit "$api")"
    worker_commit="$(image_commit "$worker")"
    web_commit="$(image_commit "$web")"
    release_sha="$(newest_commit "$api_commit" "$worker_commit" "$web_commit")"
    ;;
  run)
    : "${SHA:?}" "${RUN_ID:?}" "${RUN_NAME:?}"
    release_sha="$SHA"
    tip="$(gh api "repos/$REPO/commits/main" --jq .sha)" || die "cannot read the tip of main"
    if [ "$tip" != "$SHA" ]; then
      # Deploying SHA is harmless when nothing newer changes an image (a docs commit); otherwise the
      # newer commit's own workflows deploy, and this run would be a step backwards.
      hit="$(touches_images "$SHA" "$tip" backend.yml web.yml)"
      [ -z "$hit" ] || skip "main has moved on to $tip and $hit changed since $SHA; the newer commit deploys, not this one."
      echo "main is at $tip, but nothing that builds an image changed since $SHA."
    fi
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
    case "$backend_run $web_run" in
      *pending*) skip "The other workflow is still running for $SHA; its completion will trigger the deploy." ;;
      *cancelled*) skip "The other workflow was cancelled for $SHA; the run that replaced it will trigger the deploy." ;;
    esac
    backend_file="$(download "$backend_run" backend-digests backend-digests.json)"
    web_file="$(download "$web_run" web-digests web-digests.json)"
    api="$(jq -r '.api // empty' "$backend_file")"
    worker="$(jq -r '.worker // empty' "$backend_file")"
    web="$(jq -r '.web // empty' "$web_file")"
    ;;
  *) die "MODE must be dispatch or run" ;;
esac

jq -n --arg api "$api" --arg worker "$worker" --arg web "$web" --arg sha "$release_sha" \
  '{api: $api, worker: $worker, web: $web, sha: $sha}' > "$OUT"

# The same rule deploy.sh enforces on the host.
jq -e '
  (.api    | test("^ghcr\\.io/digibranders/idraft-api@sha256:[0-9a-f]{64}$")) and
  (.worker | test("^ghcr\\.io/digibranders/idraft-worker@sha256:[0-9a-f]{64}$")) and
  (.web    | test("^ghcr\\.io/digibranders/idraft-web@sha256:[0-9a-f]{64}$")) and
  (.sha    | test("^[0-9a-f]{40}$"))
' "$OUT" >/dev/null || die "the release record is not made of digest references: $(cat "$OUT")"

echo "Release record for $release_sha:"
cat "$OUT"

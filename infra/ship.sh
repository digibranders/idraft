#!/usr/bin/env bash
# Releases from this machine: merges develop into main, runs the checks of the parts that changed here (in
# parallel), pushes main only when they pass, then deploys to the VPS every part whose serving commit is
# behind main. The VPS switches back by itself when the new release fails its checks (infra/vps/activate.sh).
#
# Usage:
#   infra/ship.sh [<ref>]                  release <ref> (default origin/develop) onto main
#   infra/ship.sh --rollback <backend|web> serve the previous release of one part again
#
# Environment:
#   SHIP_ALL=1        check and deploy every part, changed or not
#   PYTEST_WORKERS=n  backend test workers (default 4, as many as Colima has CPUs)
#   SHIP_HOST         ssh target (default root@187.126.121.25)
#
# Works in its own worktree (.claude/worktrees/release), so it never touches another checkout.
#
# The remote commands are built here on purpose, from a commit hash and fixed paths only.
# shellcheck disable=SC2029
set -euo pipefail

host="${SHIP_HOST:-root@187.126.121.25}"
public_url=https://app.idraft.ai

say() { printf '\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\033[31mship: %s\033[0m\n' "$*" >&2; exit 1; }
remote() { ssh -o ServerAliveInterval=15 -o ServerAliveCountMax=8 "$host" "$@"; }

if [ "${1:-}" = --rollback ]; then
  case "$#:${2:-}" in
    2:backend | 2:web) remote /usr/local/sbin/idraft-activate rollback "$2" ;;
    *) die "usage: infra/ship.sh --rollback <backend|web>" ;;
  esac
  exit
fi
[ "$#" -le 1 ] || die "usage: infra/ship.sh [<ref>] | --rollback <backend|web>"
source_ref="${1:-origin/develop}"

for tool in git uv pnpm node docker ssh jq shellcheck actionlint curl; do
  command -v "$tool" >/dev/null || die "$tool is not installed"
done
# Docker runs through Colima here; Testcontainers needs the socket override (backend/tests/conftest.py).
export DOCKER_HOST="${DOCKER_HOST:-unix://$HOME/.colima/default/docker.sock}"
export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE="${TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE:-/var/run/docker.sock}"
docker info >/dev/null 2>&1 || die "Docker does not answer (colima start?)"

repo="$(cd "$(git -C "$(dirname "$0")" rev-parse --git-common-dir)/.." && pwd)"
work="$repo/.claude/worktrees/release"

say "Merging $source_ref into main"
git -C "$repo" fetch --quiet --prune origin
# The worktree lives inside the repository: if it is not a registered worktree of its own, a reset or
# clean in it would reach the main checkout. Recreate it instead.
if ! { [ -e "$work/.git" ] && [ "$(git -C "$work" rev-parse --show-toplevel 2>/dev/null)" = "$work" ]; }; then
  rm -rf "$work"
  git -C "$repo" worktree prune
  git -C "$repo" worktree add --quiet --detach "$work" origin/main
fi
cd "$work"
git reset --quiet --hard
# Installs and build caches stay between releases (they make the next run fast); tracked files do not.
git clean -ffdq -e node_modules -e .venv -e .next
git checkout --quiet --detach origin/main
git merge --quiet --no-edit "$source_ref" || { git merge --abort 2>/dev/null || true; die "$source_ref does not merge cleanly into main"; }
sha="$(git rev-parse HEAD)"

# What to check: what is new on main. What to deploy: what the VPS does not serve yet, so a deploy that
# failed after its push is retried by the next run.
changed="$(git diff --name-only origin/main HEAD)"
backend_paths='^(backend/|infra/compose/postgres/initdb/)'
web_paths='^(apps/web/|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|backend/openapi/v1\.json)'
behind_vps() {
  # behind_vps <part> <paths>: the VPS serves an older commit of this part (or a legacy release)
  local serving
  serving="$(remote /usr/local/sbin/idraft-activate deployed "$1")" || die "cannot ask the VPS what $1 serves"
  git cat-file -e "$serving^{commit}" 2>/dev/null || return 0
  git diff --name-only "$serving" HEAD | grep -qE "$2"
}
part_changed() { [ "${SHIP_ALL:-0}" = 1 ] || grep -qE "$1" <<<"$changed"; }
deploy_backend=0 deploy_web=0 backend=0 web=0 infra=0
{ [ "${SHIP_ALL:-0}" = 1 ] || behind_vps backend "$backend_paths"; } && deploy_backend=1
{ [ "${SHIP_ALL:-0}" = 1 ] || behind_vps web "$web_paths"; } && deploy_web=1
{ part_changed "$backend_paths" || [ "$deploy_backend" = 1 ]; } && backend=1
{ part_changed "$web_paths" || [ "$deploy_web" = 1 ]; } && web=1
part_changed '^(infra/|\.github/)' && infra=1
if [ "$sha" = "$(git rev-parse origin/main)" ] && [ "$deploy_backend$deploy_web" = 00 ]; then
  say "main already has $source_ref and the VPS serves it: nothing to release"
  exit 0
fi
say "Release ${sha:0:12}: check backend=$backend web=$web infra=$infra; deploy backend=$deploy_backend web=$deploy_web"

logs="$(mktemp -d "${TMPDIR:-/tmp}/idraft-ship.XXXXXX")"

# Each check is one && chain: it runs inside `if` below, where bash ignores set -e.
check_backend() {
  (cd backend && uv sync --frozen --quiet && ./check.sh -n "${PYTEST_WORKERS:-4}")
}

check_web() {
  pnpm install --frozen-lockfile --prefer-offline --silent &&
    (cd apps/web && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check &&
      NEXT_PUBLIC_APP_ENV=production NEXT_PUBLIC_API_MOCKING=off NEXT_PUBLIC_RELEASE="$sha" \
      API_INTERNAL_ORIGIN=http://127.0.0.1:8000 pnpm build && node scripts/prepare-standalone.mjs)
}

check_infra() {
  shellcheck -x infra/*.sh infra/ci/*.sh infra/host/* infra/vps/*.sh infra/test/*.sh infra/test/fake/* \
    backend/smoke.sh && bash infra/test/resolve-release.sh && actionlint
}

started=$SECONDS
names=() pids=()
run() {
  local name="$1"
  shift
  (
    start=$SECONDS
    if "$@" > "$logs/$name.log" 2>&1; then rc=0; else rc=$?; fi
    echo "$rc $((SECONDS - start))" > "$logs/$name.result"
    exit "$rc"
  ) &
  names+=("$name") pids+=("$!")
}
# Ctrl-C stops the checks too; nothing has been pushed at that point.
trap 'kill "${pids[@]}" 2>/dev/null; exit 130' INT TERM
[ "$backend" = 1 ] && run backend check_backend
[ "$web" = 1 ] && run web check_web
[ "$infra" = 1 ] && run infra check_infra
[ "${#names[@]}" -gt 0 ] && say "Checking: ${names[*]} (logs in $logs)"

failed=()
for i in "${!pids[@]}"; do
  wait "${pids[$i]}" || failed+=("${names[$i]}")
  read -r rc secs < "$logs/${names[$i]}.result"
  printf '    %-8s %s in %dm%02ds\n' "${names[$i]}" "$([ "$rc" = 0 ] && echo passed || echo FAILED)" $((secs / 60)) $((secs % 60))
done
trap - INT TERM
if [ "${#failed[@]}" -gt 0 ]; then
  for name in "${failed[@]}"; do
    printf '\n\033[31m--- %s (last 40 lines of %s) ---\033[0m\n' "$name" "$logs/$name.log"
    tail -n 40 "$logs/$name.log"
  done
  die "checks failed: ${failed[*]}. Nothing was pushed."
fi
say "All checks passed in $(((SECONDS - started) / 60))m$(((SECONDS - started) % 60))s"

if [ "$sha" != "$(git rev-parse origin/main)" ]; then
  say "Pushing main"
  git push --quiet origin HEAD:main
  git -C "$repo" fetch --quiet origin main
  git -C "$repo" branch -f main origin/main 2>/dev/null || true
fi

if [ "$deploy_backend$deploy_web" = 00 ]; then
  say "Nothing to deploy to the VPS"
  rm -rf "$logs"
  exit 0
fi

say "Uploading to the VPS"
stage="/srv/idraft/incoming/$sha"
remote "rm -rf '$stage' && install -d -m 0700 '$stage'"
git show "HEAD:infra/vps/activate.sh" | remote "install -m 0755 /dev/stdin /usr/local/sbin/idraft-activate"
if [ "$deploy_backend" = 1 ]; then
  git archive --format=tar HEAD backend | remote "cat > '$stage/backend.tar'"
fi
if [ "$deploy_web" = 1 ]; then
  # COPYFILE_DISABLE keeps macOS ._ files out. The build runs on Linux as is (no native module is loaded:
  # the app does not use next/image); sharp's macOS binaries are left out as dead weight.
  COPYFILE_DISABLE=1 tar -czf - --exclude '._*' --exclude '.env*' --exclude 'sharp-darwin*' \
    --exclude 'sharp-libvips-darwin*' -C apps/web/.next/standalone . | remote "cat > '$stage/web.tar.gz'"
fi

say "Activating on the VPS (also logged there in /var/log/idraft-activate.log)"
remote /usr/local/sbin/idraft-activate deploy "$sha" "$stage" ||
  die "activation failed: the VPS kept or restored the previous release. Fix it and run infra/ship.sh again."

for path in /api/readyz /login; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$public_url$path")"
  [ "$code" = 200 ] || die "$public_url$path answers $code after the release"
done
say "Shipped ${sha:0:12} in $((SECONDS / 60))m$((SECONDS % 60))s: $public_url"
rm -rf "$logs"

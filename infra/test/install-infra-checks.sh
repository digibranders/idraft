#!/usr/bin/env bash
# Runs inside the container started by infra/test/install-infra.sh, as root, with this infra/ tree
# mounted read-only at /src. Not meant to be run on a laptop: it rewrites /srv/idraft.
set -euo pipefail

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# stage: a fresh copy of the tree in the place CI rsyncs it to.
stage() {
  rm -rf /srv/idraft/incoming /srv/idraft/infra
  mkdir -p /srv/idraft/incoming /srv/idraft/infra
  cp -R /src /srv/idraft/incoming/infra
}

stage
# A stage that lost every exec bit (an archive, a checkout on another OS) must still install runnable scripts.
find /srv/idraft/incoming/infra -type f -exec chmod 0644 {} +
/src/host/idraft-install-infra

t=/srv/idraft/infra
roles="$t/compose/postgres/initdb/10-roles.sh"
for f in "$roles" "$t/deploy.sh" "$t/bootstrap.sh" "$t/ci/resolve-release.sh" "$t/host/idraft-install-env" "$t/host/idraft-ghcr-login"; do
  [ -x "$f" ] || fail "$f is not executable"
done
[ "$(stat -c %a "$roles")" = 755 ] || fail "the role script is mode $(stat -c %a "$roles"), not 755"
for f in "$t/compose/docker-compose.yml" "$t/compose/caddy/Caddyfile" "$t/compose/postgres/conf/postgresql.conf" "$t/README.md"; do
  [ -f "$f" ] || fail "$f is missing"
  [ "$(stat -c %a "$f")" = 644 ] || fail "$f is mode $(stat -c %a "$f"), not 644"
done
[ "$(stat -c %U:%G "$roles")" = root:root ] || fail "the role script is not owned by root"
[ "$(stat -c %a "$t")" = 755 ] || fail "$t is mode $(stat -c %a "$t"), not 755"
[ -z "$(find /srv/idraft -maxdepth 1 -name '.infra-snapshot.*')" ] || fail "the snapshot directory was left behind"

# A staged path that is a symbolic link is refused, and nothing it points at is copied.
rm -rf /srv/idraft/incoming /srv/idraft/infra
mkdir -p /srv/idraft/incoming /srv/idraft/infra /srv/secret
echo secret > /srv/secret/value
cp /src/deploy.sh /srv/secret/deploy.sh
ln -s /srv/secret /srv/idraft/incoming/infra
if /src/host/idraft-install-infra 2> /tmp/refusal; then
  fail "a symbolic link as the stage was accepted"
fi
grep -q "symbolic link" /tmp/refusal || fail "the refusal does not say why: $(cat /tmp/refusal)"
[ -z "$(ls -A /srv/idraft/infra)" ] || fail "something was copied from behind the link"
echo "install-infra checks passed"

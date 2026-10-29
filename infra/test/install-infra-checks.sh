#!/usr/bin/env bash
# Runs inside the container started by infra/test/install-infra.sh, as root, with this infra/ tree
# mounted read-only at /src. Not meant to be run on a laptop: it rewrites /srv/idraft.
set -euo pipefail

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# The account CI logs in as, owning the stage the way bootstrap.sh sets it up.
id -u deploy >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash deploy

# stage: a fresh copy of the tree in the place CI rsyncs it to, owned by the deploy user.
stage() {
  rm -rf /srv/idraft/incoming /srv/idraft/infra
  mkdir -p /srv/idraft/incoming /srv/idraft/infra
  cp -R /src /srv/idraft/incoming/infra
  chown -R deploy:deploy /srv/idraft/incoming
  chmod 0700 /srv/idraft/incoming
}

# A directory only root can read, standing in for /etc/idraft.
# Made at run time, so it appears in no staged file (this script is staged too).
secret_value="root-only-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
make_secret() {
  rm -rf /srv/secret
  mkdir -p /srv/secret
  echo "$secret_value" > /srv/secret/value
  cp /src/deploy.sh /srv/secret/deploy.sh
  chmod 0700 /srv/secret
}

assert_no_leak() {
  if grep -rqs "$secret_value" /srv/idraft; then
    fail "$1: the root-only secret reached /srv/idraft"
  fi
  [ -z "$(find /srv/idraft -maxdepth 1 -name '.infra-snapshot.*')" ] || fail "$1: the snapshot directory was left behind"
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

# The deploy user can swap the stage, or anything in it, for a link at any moment, so there is no check
# to win a race against: whatever a link points at, only what the deploy user could read itself is copied.
make_secret

# The stage itself swapped for a link to a root-only directory: the read fails and nothing is installed.
stage
rm -rf /srv/idraft/incoming/infra
ln -s /srv/secret /srv/idraft/incoming/infra
chown -h deploy:deploy /srv/idraft/incoming/infra
if /src/host/idraft-install-infra 2> /tmp/refusal; then
  fail "a stage linked to a root-only directory was installed"
fi
grep -q "Could not read" /tmp/refusal || fail "the refusal does not say why: $(cat /tmp/refusal)"
[ -z "$(ls -A /srv/idraft/infra)" ] || fail "something was copied from behind the stage link"
assert_no_leak "stage link"

# Links inside the stage, to the root-only directory and to a file in it: skipped, the rest installs.
stage
ln -s /srv/secret /srv/idraft/incoming/infra/compose/leak
ln -s /srv/secret/value /srv/idraft/incoming/infra/leak.txt
chown -h deploy:deploy /srv/idraft/incoming/infra/compose/leak /srv/idraft/incoming/infra/leak.txt
/src/host/idraft-install-infra > /dev/null 2>&1 || fail "a stage with links inside was not installed"
[ -f "$t/deploy.sh" ] || fail "the stage with links inside did not install deploy.sh"
if [ -e "$t/compose/leak" ] || [ -e "$t/leak.txt" ]; then
  fail "a link inside the stage was copied"
fi
assert_no_leak "links inside the stage"

# A stage owned by root is refused: the sender would read with root's rights again.
stage
chown root:root /srv/idraft/incoming
if /src/host/idraft-install-infra 2> /tmp/refusal; then
  fail "a root-owned stage was accepted"
fi
grep -q "must belong to the deploy user" /tmp/refusal || fail "the refusal does not say why: $(cat /tmp/refusal)"
echo "install-infra checks passed"

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

# idraft-install-env stages only an env that cannot choose what runs as root.
mkdir -p /etc/idraft
chmod 0700 /etc/idraft
good=/src/compose/.env.example
# Where bootstrap.sh installs the checker, and the only place idraft-install-env looks for it.
install -m 0755 -o root -g root /src/host/idraft-check-env /usr/local/sbin/idraft-check-env
/src/host/idraft-install-env < "$good" > /dev/null || fail "the example env was refused"
cmp -s "$good" /etc/idraft/.env.next || fail "the staged env differs from the input"
[ "$(stat -c '%a %U' /etc/idraft/.env.next)" = "600 root" ] || fail ".env.next is $(stat -c '%a %U' /etc/idraft/.env.next), not 600 root"

# refused <case> <expected message> <sed expression applied to the example env>
refused() {
  rm -f /etc/idraft/.env.next
  sed "$3" "$good" > /tmp/bad.env
  check_refusal "$1" "$2"
}

# refused_raw <case> <expected message> <printf %b text appended to the example env>
refused_raw() {
  rm -f /etc/idraft/.env.next
  { cat "$good"; printf '%b' "$3"; } > /tmp/bad.env
  check_refusal "$1" "$2"
}

# check_refusal <case> <expected message>: idraft-install-env on /tmp/bad.env must refuse and stage nothing.
check_refusal() {
  if /src/host/idraft-install-env < /tmp/bad.env 2> /tmp/refusal; then
    fail "$1 was accepted"
  fi
  grep -q "$2" /tmp/refusal || fail "$1: the refusal does not say why: $(cat /tmp/refusal)"
  [ ! -e /etc/idraft/.env.next ] || fail "$1 was staged"
  [ -z "$(find /etc/idraft -name '.env.next.*')" ] || fail "$1 left a temporary file"
}
digest=sha256:4764ce37931aac77c0d033680b339b19b4a4a81772204d268947cb851212d0ac
refused "a foreign Caddy image" "CADDY_IMAGE must be" "s|^CADDY_IMAGE=.*|CADDY_IMAGE=ghcr.io/attacker/caddy@$digest|"
refused "an unpinned Postgres image" "POSTGRES_IMAGE must be" "s|^POSTGRES_IMAGE=.*|POSTGRES_IMAGE=postgres:18|"
refused "a Redis image of another repository" "REDIS_IMAGE must be" "s|^REDIS_IMAGE=.*|REDIS_IMAGE=redis-evil@$digest|"
refused "an image variable Compose does not use" "is not an image" "\$a EXTRA_IMAGE=busybox@$digest"
refused "the Redis ACL dir set to /" "REDIS_ACL_DIR must be /etc/idraft/redis" "s|^REDIS_ACL_DIR=.*|REDIS_ACL_DIR=/|"
refused "the Redis ACL dir behind export" "not KEY=value" "s|^REDIS_ACL_DIR=.*|export REDIS_ACL_DIR=/|"
refused "the Redis ACL dir with spaces around =" "not KEY=value" "s|^REDIS_ACL_DIR=.*|REDIS_ACL_DIR = /|"
refused "a Compose setting" "COMPOSE_FILE may not be set" "\$a COMPOSE_FILE=/tmp/evil.yml"
refused "a quoted value" "quoted value" "s|^DOMAIN=.*|DOMAIN=\"app.idraft.ai\"|"
refused_raw "a tab" "outside printable ASCII" 'EXTRA=a\tb\n'
refused_raw "a carriage return" "outside printable ASCII" 'EXTRA=a\r\n'
refused_raw "a NUL byte" "outside printable ASCII" 'EXTRA=a\0b\n'
refused_raw "a high byte" "outside printable ASCII" 'EXTRA=a\0377b\n'
refused_raw "a space before a quote" "space before a quoted value" 'EXTRA= "x"\n'

# A checker that merely sits beside the script is never used: only the installed one counts.
rm -rf /tmp/lookalike /etc/idraft/.env.next
mkdir /tmp/lookalike
cp /src/host/idraft-install-env /tmp/lookalike/
printf '#!/bin/sh\nexit 0\n' > /tmp/lookalike/idraft-check-env
chmod 0755 /tmp/lookalike/idraft-check-env
{ cat "$good"; echo "COMPOSE_FILE=/tmp/evil.yml"; } > /tmp/bad.env
if /tmp/lookalike/idraft-install-env < /tmp/bad.env > /dev/null 2>&1; then
  fail "idraft-install-env used a checker found beside itself"
fi
[ ! -e /etc/idraft/.env.next ] || fail "a hostile env was staged through a checker beside the script"
echo "install-env checks passed"

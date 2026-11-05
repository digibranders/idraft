#!/usr/bin/env bash
# One-time, on the VPS as root: turns the hand-built install into the release layout infra/vps/activate.sh
# deploys into, installs that script as /usr/local/sbin/idraft-activate, and clears what the old firstfold
# project left behind. Safe to run again, also after an interruption: each step checks what is done.
#
#   scp -r infra/vps root@187.126.121.25:/root/idraft-vps && ssh root@187.126.121.25 bash /root/idraft-vps/setup-releases.sh
#
# The serving code becomes the release "legacy-<date>" and the one before it (web.prev) its previous release,
# so infra/ship.sh --rollback works from the first deploy. The services restart once through the new links
# and are checked; nothing else about them changes.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
R=/srv/idraft/releases
log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }
[ -f "$here/activate.sh" ] || die "copy the whole infra/vps folder: activate.sh is missing next to this script"

log "1. Database backup"
install -d -m 0700 /srv/idraft/backups
dump="/srv/idraft/backups/pre-setup-$(date -u +%Y%m%dT%H%M%SZ).dump"
# shellcheck disable=SC2024
sudo -u postgres /usr/lib/postgresql/18/bin/pg_dump -p 5433 -Fc -d idraft > "$dump" || { rm -f "$dump"; die "backup failed"; }
chmod 0600 "$dump"
log "   $dump"

log "2. Release folders"
install -d -m 0755 "$R/backend" "$R/web"
adopt() {
  # adopt <live path> <part>: move the real folder into the release tree and link it back. A run cut off
  # between the move and the links finds the moved folder and only makes the links.
  local live="$1" part="$2" legacy
  if [ -L "$live" ]; then
    log "   $live is already a link"
    return
  fi
  if [ -d "$live" ]; then
    legacy="$R/$part/legacy-$(date -u +%Y%m%d)"
    [ ! -e "$legacy" ] || die "$legacy exists and $live is still a folder: sort it out by hand"
    rm -f "$live"/._*
    mv "$live" "$legacy"
  else
    # shellcheck disable=SC2012
    legacy="$(ls -1d "$R/$part"/legacy-2* 2>/dev/null | tail -n 1)"
    [ -n "$legacy" ] || die "$live is gone and no legacy release was found"
  fi
  ln -sfn "$legacy" "$R/$part/current"
  ln -sfn "$R/$part/current" "$live"
  log "   $live -> $legacy"
}
adopt /srv/idraft/backend backend
adopt /srv/idraft/web web
if [ -d /srv/idraft/web.prev ] && [ ! -L /srv/idraft/web.prev ]; then
  mv /srv/idraft/web.prev "$R/web/legacy-prev"
fi
[ ! -d "$R/web/legacy-prev" ] || ln -sfn "$R/web/legacy-prev" "$R/web/previous"
install -m 0755 "$here/activate.sh" /usr/local/sbin/idraft-activate
sed -i 's/^Description=idraft web (mock mode demo)$/Description=idraft web/' /etc/systemd/system/idraft-web.service
systemctl daemon-reload

log "3. Restart through the links and check"
since="$(date +%s)"
systemctl restart idraft-api idraft-worker idraft-web
ok() {
  for _ in $(seq 60); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$1")" = 200 ] && { log "   ok: $1"; return 0; }
    sleep 1
  done
  die "$1 does not answer 200"
}
ok http://127.0.0.1:8000/api/readyz
ok http://127.0.0.1:3010/login
fresh=0
for _ in $(seq 60); do
  if [ -f /run/idraft-worker/heartbeat ] && [ "$(stat -c %Y /run/idraft-worker/heartbeat)" -ge "$since" ]; then
    fresh=1
    break
  fi
  sleep 1
done
[ "$fresh" = 1 ] || die "the worker wrote no heartbeat within 60s"
log "   ok: worker heartbeat"
for unit in idraft-api idraft-worker idraft-web; do
  systemctl is-active --quiet "$unit" || die "$unit is not active"
done

log "4. Security reboots at 04:30 UTC when an update needs one (owner decision D5, 2026-11-05)"
rm -f /etc/apt/apt.conf.d/52firstfold-unattended
cat > /etc/apt/apt.conf.d/52idraft-unattended <<'CONF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-WithUsers "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
CONF

log "5. firstfold leftovers"
rm -f /etc/sudoers.d/firstfold-deploy
visudo -c >/dev/null
rm -f /usr/local/sbin/firstfold-*
rm -f /etc/nginx/sites-enabled/firstfold /etc/nginx/sites-enabled/firstfold-website \
  /etc/nginx/sites-available/firstfold /etc/nginx/sites-available/firstfold-website
nginx -t
systemctl reload nginx
rm -f /home/deploy/.ssh/github-firstfold-* /home/deploy/.ssh/config /home/deploy/.ssh/known_hosts
for rule in 7881/tcp 7882/udp 3478/udp; do ufw --force delete allow "$rule" </dev/null >/dev/null 2>&1 || true; done
# The Cloudflare-only rules add nothing while 80/tcp and 443/tcp are open to everyone; check that first.
if ufw status | grep -qE '^80/tcp +ALLOW +Anywhere *$' && ufw status | grep -qE '^443/tcp +ALLOW +Anywhere *$'; then
  while n="$(ufw status numbered | sed -n 's/^\[ *\([0-9]*\)\].*cloudflare-web.*/\1/p' | tail -n 1)"; [ -n "$n" ]; do
    ufw --force delete "$n" </dev/null >/dev/null
  done
else
  log "   80/tcp or 443/tcp is not open to everyone: the Cloudflare rules stay"
fi

log "Done. Firewall now:"
ufw status | sed -n '/^To/,$p'

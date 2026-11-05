#!/usr/bin/env bash
# One-time, on the VPS as root: turns the hand-built install into the release layout infra/vps/activate.sh
# deploys into, and clears what the old firstfold project left behind. Safe to run again: each step checks
# whether it is already done.
#
#   ssh root@187.126.121.25 'bash -s' < infra/vps/setup-releases.sh
#
# The serving code becomes the release "legacy-<date>", the one before it (web.prev) its previous release,
# so infra/ship.sh --rollback works from the first deploy. Services restart once through the new links and
# are checked; nothing else about them changes.
set -euo pipefail

R=/srv/idraft/releases
stamp="$(date -u +%Y%m%d)"
log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"; }

log "1. Database backup"
install -d -m 0700 /srv/idraft/backups
# shellcheck disable=SC2024
sudo -u postgres /usr/lib/postgresql/18/bin/pg_dump -p 5433 -Fc -d idraft \
  > "/srv/idraft/backups/pre-setup-$(date -u +%Y%m%dT%H%M%SZ).dump"
chmod 0600 /srv/idraft/backups/*.dump

log "2. Release folders"
install -d -m 0755 "$R/backend" "$R/web"
adopt() {
  # adopt <live path> <component>: move a real folder into the release tree and link it back
  local live="$1" component="$2"
  if [ -L "$live" ]; then
    log "   $live is already a link"
    return
  fi
  rm -f "$live"/._*
  mv "$live" "$R/$component/legacy-$stamp"
  ln -sfn "$R/$component/legacy-$stamp" "$R/$component/current"
  ln -sfn "$R/$component/current" "$live"
  log "   $live -> $R/$component/legacy-$stamp"
}
adopt /srv/idraft/backend backend
adopt /srv/idraft/web web
if [ -d /srv/idraft/web.prev ] && [ ! -L /srv/idraft/web.prev ]; then
  mv /srv/idraft/web.prev "$R/web/legacy-prev"
  ln -sfn "$R/web/legacy-prev" "$R/web/previous"
fi
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
  log "   FAILED: $1"
  return 1
}
ok http://127.0.0.1:8000/api/readyz
ok http://127.0.0.1:3010/login
for _ in $(seq 60); do
  if [ -f /run/idraft-worker/heartbeat ] && [ "$(stat -c %Y /run/idraft-worker/heartbeat)" -ge "$since" ]; then
    log "   ok: worker heartbeat"
    break
  fi
  sleep 1
done
systemctl is-active --quiet idraft-api idraft-worker idraft-web

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
rm -f /usr/local/sbin/firstfold-* /etc/nginx/sites-available/firstfold /etc/nginx/sites-available/firstfold-website
rm -f /home/deploy/.ssh/github-firstfold-* /home/deploy/.ssh/config /home/deploy/.ssh/known_hosts
for rule in 7881/tcp 7882/udp 3478/udp; do ufw delete allow "$rule" >/dev/null 2>&1 || true; done
# 80/tcp and 443/tcp are open to everyone already; the Cloudflare-only rules add nothing.
while n="$(ufw status numbered | sed -n 's/^\[ *\([0-9]*\)\].*cloudflare-web.*/\1/p' | tail -n 1)"; [ -n "$n" ]; do
  ufw --force delete "$n" >/dev/null
done
nginx -t 2>/dev/null

log "Done. Firewall now:"
ufw status | sed -n '/^To/,$p'

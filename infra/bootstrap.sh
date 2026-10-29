#!/usr/bin/env bash
# Bootstrap a clean Ubuntu host for the idraft.ai production runtime.
# Idempotent: re-running with the same arguments changes nothing and restarts nothing.
#
# Usage (as root, from a copy of the whole infra/ directory, because it installs infra/host/*):
#   bootstrap.sh --deploy-key <public-key-file> [--harden-ssh]
#
#   --deploy-key   public key CI uses to log in as `deploy`; installed as its only authorized key
#   --harden-ssh   key-only SSH and no root password login. Run it only after you have logged in as
#                  root and as deploy with keys; it refuses if either account has no authorized key.
set -euo pipefail

die() {
  echo "bootstrap.sh: $*" >&2
  exit 1
}

if [ "$(id -u)" -ne 0 ]; then
  die "must run as root."
fi

here="$(cd "$(dirname "$0")" && pwd)"
deploy_key_file=""
harden_ssh=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --deploy-key)
      [ "$#" -ge 2 ] || die "--deploy-key needs a file."
      deploy_key_file="$2"
      shift 2
      ;;
    --harden-ssh)
      harden_ssh=1
      shift
      ;;
    *) die "unknown argument: $1" ;;
  esac
done

for helper in idraft-install-env idraft-check-env idraft-install-infra idraft-ghcr-login; do
  [ -f "$here/host/$helper" ] || die "$here/host/$helper is missing; run this from a copy of the whole infra/ directory."
done

echo "=== 1. Base packages ==="
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  gnupg \
  jq \
  unattended-upgrades \
  fail2ban \
  python3-systemd \
  zstd \
  rsync \
  sudo \
  openssh-client \
  ufw

echo "=== 2. Deploy user, keys, sudo and directories ==="
if ! id -u deploy >/dev/null 2>&1; then
  useradd --system --create-home --shell /bin/bash deploy
fi
deploy_home="$(getent passwd deploy | cut -d: -f6)"

install -d -m 0700 -o deploy -g deploy "$deploy_home/.ssh"
if [ -n "$deploy_key_file" ]; then
  [ -f "$deploy_key_file" ] || die "deploy key file not found: $deploy_key_file"
  if grep -q 'PRIVATE KEY' "$deploy_key_file"; then
    die "$deploy_key_file holds a private key. Pass the public key."
  fi
  ssh-keygen -l -f "$deploy_key_file" >/dev/null || die "$deploy_key_file is not a valid public key."
  install -m 0600 -o deploy -g deploy "$deploy_key_file" "$deploy_home/.ssh/authorized_keys"
fi
if [ -f "$deploy_home/.ssh/authorized_keys" ]; then
  chown deploy:deploy "$deploy_home/.ssh/authorized_keys"
  chmod 0600 "$deploy_home/.ssh/authorized_keys"
fi

# Everything sudo may run is root-owned and out of the deploy user's reach. Deploy stages files in
# /srv/idraft/incoming and root-run installers copy them into place.
# ensure_dir <mode> <owner> <group> <path>...: creates a missing directory with the intended mode and
# owner, and leaves an existing one alone, so re-running on a live host never re-owns or re-modes
# a directory the running stack depends on (for example /etc/idraft/redis, owned and read by Redis).
ensure_dir() {
  local mode="$1" owner="$2" group="$3" path
  shift 3
  for path in "$@"; do
    if [ -e "$path" ]; then
      echo "Left alone (exists): $path ($(stat -c '%a %U:%G' "$path"))"
    else
      install -d -m "$mode" -o "$owner" -g "$group" "$path"
    fi
  done
}
ensure_dir 0755 root root /srv/idraft /srv/idraft/releases /srv/idraft/infra /srv/idraft/shared
ensure_dir 0700 deploy deploy /srv/idraft/incoming
ensure_dir 0700 root root /etc/idraft
ensure_dir 0711 root root /etc/idraft/redis
install -m 0755 -o root -g root "$here/host/idraft-install-env" /usr/local/sbin/idraft-install-env
# Called by idraft-install-env from its own directory; not in sudoers, it needs no root.
install -m 0755 -o root -g root "$here/host/idraft-check-env" /usr/local/sbin/idraft-check-env
install -m 0755 -o root -g root "$here/host/idraft-install-infra" /usr/local/sbin/idraft-install-infra
install -m 0755 -o root -g root "$here/host/idraft-ghcr-login" /usr/local/sbin/idraft-ghcr-login

# "" means no arguments: the helpers take none, and deploy.sh may only run in the two forms CI uses.
sudoers_tmp="$(mktemp)"
trap 'rm -f "$sudoers_tmp"' EXIT
cat > "$sudoers_tmp" <<'SUDOERS'
# Managed by infra/bootstrap.sh. The deploy user may run exactly these commands as root.
Defaults:deploy env_reset
deploy ALL=(root) NOPASSWD: /usr/local/sbin/idraft-install-env "", \
    /usr/local/sbin/idraft-install-infra "", \
    /usr/local/sbin/idraft-ghcr-login "", \
    /srv/idraft/infra/deploy.sh /etc/idraft/.env /srv/idraft/incoming/digests.json, \
    /srv/idraft/infra/deploy.sh --rollback /etc/idraft/.env
SUDOERS
visudo -cf "$sudoers_tmp" >/dev/null || die "the generated sudoers rule failed visudo validation."
install -m 0440 -o root -g root "$sudoers_tmp" /etc/sudoers.d/idraft-deploy

echo "=== 3. Swap and kernel configuration ==="
# 2 GB swap file as safety buffer for spikes and background workers.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi

# Kernel memory and socket tuning for Redis and high concurrency.
cat > /etc/sysctl.d/60-idraft.conf <<'SYSCTL'
vm.overcommit_memory = 1
vm.swappiness = 10
net.core.somaxconn = 1024
net.ipv4.tcp_max_syn_backlog = 2048
kernel.panic = 10
SYSCTL
sysctl --system >/dev/null 2>&1 || true

echo "=== 4. Docker Engine and Compose plugin ==="
install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.asc ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
fi

# Add Docker apt repository using the signed keyring.
arch="$(dpkg --print-architecture)"
# shellcheck source=/dev/null
codename="$(. /etc/os-release && echo "$VERSION_CODENAME")"
echo "deb [arch=$arch signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $codename stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update -y
apt-get install -y --no-install-recommends \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin

# The deploy user stays out of the docker group (membership is root on the host). Every docker call
# goes through the sudo-allowed, root-owned scripts; an earlier run may have added it, so remove it.
if id -nG deploy | tr ' ' '\n' | grep -qx docker; then
  gpasswd -d deploy docker
fi

# Docker daemon defaults. Rewritten, and Docker restarted, only when the content differs.
mkdir -p /etc/docker
daemon_tmp="$(mktemp)"
trap 'rm -f "$sudoers_tmp" "$daemon_tmp"' EXIT
cat > "$daemon_tmp" <<'DAEMON'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "5",
    "compress": "true"
  },
  "ip": "127.0.0.1",
  "live-restore": true,
  "no-new-privileges": true,
  "userland-proxy": false,
  "default-ulimits": {
    "nofile": { "Name": "nofile", "Soft": 65536, "Hard": 65536 }
  }
}
DAEMON
if ! cmp -s "$daemon_tmp" /etc/docker/daemon.json; then
  install -m 0644 -o root -g root "$daemon_tmp" /etc/docker/daemon.json
  systemctl restart docker
fi

echo "=== 5. Unattended upgrades ==="
cat > /etc/apt/apt.conf.d/52idraft-unattended-upgrades <<'UPGRADES'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-WithUsers "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
UPGRADES

cat > /etc/apt/apt.conf.d/20auto-upgrades <<'AUTO'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
AUTO

echo "=== 6. fail2ban SSH jail ==="
mkdir -p /etc/fail2ban/jail.d
cat > /etc/fail2ban/jail.d/sshd.local <<'F2B'
[sshd]
enabled = true
backend = systemd
maxretry = 5
bantime = 1h
F2B
systemctl enable --now fail2ban >/dev/null

echo "=== 7. Firewall configuration ==="
# The port sshd really listens on, so a non-default port is not locked out.
ssh_ports="$(sshd -T | awk '$1 == "port" {print $2}')"
[ -n "$ssh_ports" ] || die "could not read the sshd port from 'sshd -T'; refusing to enable the firewall."
ufw default deny incoming
ufw default allow outgoing
for port in $ssh_ports; do
  ufw allow "$port/tcp"
done
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable >/dev/null

echo "=== 8. SSH hardening ==="
has_key() {
  [ -f "$1" ] && grep -qvE '^[[:space:]]*(#|$)' "$1"
}
if [ "$harden_ssh" -eq 1 ]; then
  has_key /root/.ssh/authorized_keys || die "/root/.ssh/authorized_keys has no key; hardening would lock root out."
  has_key "$deploy_home/.ssh/authorized_keys" || die "$deploy_home/.ssh/authorized_keys has no key; pass --deploy-key."
  mkdir -p /etc/ssh/sshd_config.d
  cat > /etc/ssh/sshd_config.d/10-idraft-hardening.conf <<'SSHD'
PermitRootLogin prohibit-password
PasswordAuthentication no
PubkeyAuthentication yes
AuthenticationMethods publickey
MaxAuthTries 3
X11Forwarding no
AllowTcpForwarding no
PermitTunnel no
SSHD
  if ! sshd -t; then
    rm -f /etc/ssh/sshd_config.d/10-idraft-hardening.conf
    die "sshd rejected the hardening file; it was removed."
  fi
  systemctl reload ssh || systemctl reload sshd
else
  echo "Skipped. Log in as root and as deploy with keys, then re-run with --harden-ssh."
fi

echo "Bootstrap completed successfully."

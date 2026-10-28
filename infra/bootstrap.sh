#!/usr/bin/env bash
# Bootstrap a clean Ubuntu host for idraft.ai production runtime.
# Idempotent: re-running this script changes nothing.
set -euo pipefail

# Ensure the script is run with superuser privileges.
if [ "$(id -u)" -ne 0 ]; then
  echo "bootstrap.sh must run as root." >&2
  exit 1
fi

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
  zstd \
  rsync \
  ufw

echo "=== 2. Deploy user and directories ==="
# Create deploy group and user if they do not exist.
if ! id -u deploy >/dev/null 2>&1; then
  useradd --system --create-home --shell /bin/bash deploy
fi

# Ensure deploy user .ssh directory exists with restricted permissions.
mkdir -p /home/deploy/.ssh
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
if [ -f /home/deploy/.ssh/authorized_keys ]; then
  chmod 600 /home/deploy/.ssh/authorized_keys
fi

# Create directory tree for releases and runtime state.
mkdir -p /srv/idraft/releases /srv/idraft/infra /srv/idraft/shared /etc/idraft/redis
chown -R deploy:deploy /srv/idraft
chmod 755 /srv/idraft
chmod 700 /etc/idraft

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

# Ensure deploy user is in the docker group.
usermod -aG docker deploy

# Configure Docker daemon defaults to prevent unbounded log growth.
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'DAEMON'
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

systemctl restart docker >/dev/null 2>&1 || true

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
systemctl enable --now fail2ban >/dev/null 2>&1 || true

echo "=== 7. Firewall configuration ==="
# Allow SSH, HTTP, and HTTPS traffic only.
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable >/dev/null 2>&1 || true

echo "=== 8. SSH hardening ==="
# Restrict SSH authentication to public keys.
mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/10-idraft-hardening.conf <<'SSHD'
PasswordAuthentication no
PubkeyAuthentication yes
AuthenticationMethods publickey
MaxAuthTries 3
X11Forwarding no
AllowTcpForwarding no
PermitTunnel no
SSHD

# Only validate and reload ssh if sshd config test succeeds.
if sshd -t >/dev/null 2>&1; then
  systemctl reload ssh >/dev/null 2>&1 || systemctl reload sshd >/dev/null 2>&1 || true
fi

echo "Bootstrap completed successfully."

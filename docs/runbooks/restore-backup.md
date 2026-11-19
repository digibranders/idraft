# Runbook: Restoring from Backup

This runbook covers the procedures for restoring PostgreSQL databases from encrypted backups stored in Cloudflare R2 (`seo-backups`).

## Overview and Storage Layout

Backups are taken nightly by `infra/backup/pg-backup.sh`. Dumps are created in custom format (`pg_dump -Fc` with zstd compression), encrypted with `age` using recipient public keys, and stored in R2:

- Manifest: `seo-backups/daily/idraft-<timestamp>.manifest.json`
- Encrypted dump: `seo-backups/daily/idraft-<timestamp>.pgdump.age`
- Encrypted globals: `seo-backups/daily/idraft-<timestamp>.globals.sql.age`

The private decryption key (`recovery.key`) is stored offline in the owner password manager and is never retained on the server.

## Procedure 1: Automated Restore Drill (Scratch Container)

The restore drill verifies backup integrity without touching live data. It downloads the newest daily dump, decrypts it, boots a disposable scratch PostgreSQL container, restores the dump, and verifies row counts and checksums against the manifest.

To execute a restore drill manually on the host:

```bash
export AGE_IDENTITY_FILE="/path/to/offline/recovery.key"
/srv/idraft/infra/backup/pg-restore-drill.sh
```

A clean run drops the scratch container, logs matching checksums, and exits with code 0.

## Procedure 2: Disaster Recovery on a Fresh Host

If the primary VPS is lost and the system is rebuilt on a fresh server:

### 1. Bootstrap the Fresh Host

Follow `infra/README.md` to run `infra/bootstrap.sh` and populate `/etc/idraft/.env`.

### 2. Start PostgreSQL and Redis Containers Only

```bash
cd /srv/idraft/infra/compose
docker compose --env-file /etc/idraft/.env up -d postgres redis

# Wait for postgres to be healthy
until [ "$(docker inspect -f '{{.State.Health.Status}}' idraft-postgres 2>/dev/null)" = "healthy" ]; do
  echo "Waiting for postgres..."
  sleep 2
done
```

### 3. Retrieve and Decrypt the Target Backup

On a machine with access to the age recovery key and R2 backups:

```bash
# 1. Download newest manifest and dump
rclone copyto r2-backups:seo-backups/daily/idraft-<timestamp>.manifest.json ./manifest.json
rclone copyto r2-backups:seo-backups/daily/idraft-<timestamp>.pgdump.age ./dump.age
rclone copyto r2-backups:seo-backups/daily/idraft-<timestamp>.globals.sql.age ./globals.sql.age

# 2. Verify SHA-256 checksum
expected_sha=$(jq -r '.dump.sha256' ./manifest.json)
actual_sha=$(shasum -a 256 ./dump.age | awk '{print $1}')
if [ "$expected_sha" != "$actual_sha" ]; then
  echo "Checksum mismatch! Abort."
  exit 1
fi

# 3. Decrypt with age private key
age -d -i recovery.key ./dump.age > ./restored.pgdump
age -d -i recovery.key ./globals.sql.age > ./restored.globals.sql
```

### 4. Restore Globals and Database

Copy decrypted artifacts to the host, or stream via SSH:

```bash
# 1. Restore globals (roles and configurations)
docker exec -i -u postgres idraft-postgres psql -d postgres < ./restored.globals.sql

# 2. Re-apply role passwords from /etc/idraft/.env
docker exec -i -u postgres idraft-postgres /docker-entrypoint-initdb.d/10-roles.sh

# 3. Restore database content
docker exec -i -u postgres idraft-postgres pg_restore -d idraft --clean --if-exists --no-owner < ./restored.pgdump
```

### 5. Verify and Start Application Services

```bash
# 1. Check table row counts and schema version
docker exec -i -u postgres idraft-postgres psql -d idraft -c "SELECT count(*) FROM auth.workspaces;"

# 2. Start remaining containers
cd /srv/idraft/infra/compose
docker compose --env-file /etc/idraft/.env up -d api worker web caddy

# 3. Confirm endpoint health
curl -fsS https://app.idraft.ai/api/readyz
```

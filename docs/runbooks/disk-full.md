# Runbook: Disk Full Emergency Response

This runbook documents emergency triage and recovery when disk usage on the host exceeds critical thresholds (warning at 70%, critical at 85%).

## Symptoms and Alerts

- Alert from `infra/monitoring/host-check.sh` via Healthchecks: `Disk usage on / is critical: >= 85%`.
- Docker errors: `write: no space left on device` or inability to pull new image layers.
- PostgreSQL log: `PANIC: could not write to file "pg_wal/..."` or transaction commits failing with read-only filesystem errors.

## Phase 1: Emergency Breathing Room (Release Ballast)

The bootstrap script provisions a 1 GB sacrificial ballast file at `/srv/idraft/ballast.bin`.

If disk space reaches 95% to 100% and processes are crashing, delete the ballast file immediately to regain 1 GB of working space:

```bash
# 1. Check current disk usage
df -h /

# 2. Delete sacrificial ballast file
rm -f /srv/idraft/ballast.bin

# 3. Confirm available space has increased
df -h /
```

This immediately restores sufficient room to run commands, inspect logs, and clean up.

## Phase 2: Docker Reclamation

Old container images and build caches are the most common source of rapid disk consumption.

```bash
# 1. Prune dangling and unused Docker images
docker image prune -af --filter "until=48h"

# 2. Prune stopped build caches and unused containers
docker system prune -f --volumes=false

# 3. Inspect container log sizes
du -sh /var/lib/docker/containers/*/*-json.log 2>/dev/null | sort -hr | head -n 10
```

If a specific container log has grown uncontrollably:

```bash
truncate -s 0 /var/lib/docker/containers/<container_id>/<container_id>-json.log
```

## Phase 3: System and Journal Reclamation

Reclaim host logs and package manager caches:

```bash
# 1. Vacuum systemd journal to 200 MB
journalctl --vacuum-size=200M

# 2. Clean apt cache
apt-get clean
apt-get autoremove -y

# 3. Clean temporary files
rm -rf /tmp/idraft-*
```

## Phase 4: PostgreSQL Storage Inspection

PostgreSQL data resides in the Docker named volume `pgdata`. Inspect database sizes:

```bash
docker exec -i -u postgres idraft-postgres psql -d idraft << 'SQL'
SELECT pg_size_pretty(pg_database_size('idraft')) AS db_size;

SELECT relname, n_dead_tup, last_vacuum, last_autovacuum
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 10;
SQL
```

If bloated tables have high dead tuple counts, trigger an autovacuum:

```bash
docker exec -i -u postgres idraft-postgres psql -d idraft -c "VACUUM (ANALYZE) ops.collection_tasks;"
```

## Phase 5: Recreate Ballast File

Once disk usage drops back below 65%, recreate the 1 GB ballast file so future emergencies have the same safety margin:

```bash
fallocate -l 1G /srv/idraft/ballast.bin
chmod 600 /srv/idraft/ballast.bin
```

Verify disk health:

```bash
/srv/idraft/infra/monitoring/host-check.sh
```

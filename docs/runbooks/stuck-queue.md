# Runbook: Diagnosing and Resolving Stuck Queues

This runbook covers how to inspect, unblock, and resolve stalled background queues in Taskiq and Redis.

## Queue Architecture

idraft.ai uses Taskiq with Redis 8 as the broker. Work is split across two queues:
- `collect`: external SERP dispatch, provider polling, and raw payload storage in Cloudflare R2
- `process`: snapshot ingestion, domain rank calculation, metric rollups, and maintenance jobs

## Diagnostic Steps

### 1. Check Worker Heartbeat and Health

The worker writes a periodic heartbeat file. Check if the heartbeat is updating:

```bash
docker exec idraft-worker python -m idraft.worker.healthcheck
```

If the healthcheck fails or times out, the worker event loop is blocked or crashed.

### 2. Inspect Redis Queue Depths

Check the number of pending tasks in Redis:

```bash
docker exec idraft-redis redis-cli -a "<worker_password>" LLEN "taskiq:collect"
docker exec idraft-redis redis-cli -a "<worker_password>" LLEN "taskiq:process"
```

If `LLEN taskiq:collect` is high and not decreasing, external provider calls may be failing or timing out.

### 3. Check for Open Dispatched Tasks in Database

Run a query to find tasks that have been in `dispatched` or `processing` state for more than 2 hours:

```bash
docker exec -i -u postgres idraft-postgres psql -d idraft << 'SQL'
SELECT id, schedule_id, provider, state, dispatched_at, updated_at
FROM ops.collection_tasks
WHERE state IN ('dispatched', 'processing')
  AND dispatched_at < NOW() - INTERVAL '2 hours'
ORDER BY dispatched_at ASC
LIMIT 20;
SQL
```

### 4. Check Worker Logs

Inspect recent logs for unhandled exceptions or connection errors:

```bash
docker compose -f /srv/idraft/infra/compose/docker-compose.yml --env-file /etc/idraft/.env logs --tail 200 -f worker
```

Common causes:
- Provider rate limits or 401 Unauthorized errors from DataForSEO
- R2 upload errors or network timeouts
- PostgreSQL lock waits or connection exhaustion

## Remediation Procedures

### Remediation A: Restart Worker

If the worker process is frozen:

```bash
cd /srv/idraft/infra/compose
docker compose --env-file /etc/idraft/.env restart worker
```

Wait 15 seconds and check the heartbeat:

```bash
docker exec idraft-worker python -m idraft.worker.healthcheck
```

### Remediation B: Fail Stalled Tasks in Database

If tasks were dispatched to a provider but never resolved, mark them failed so the scheduler can create new tasks during the next collection window:

```bash
docker exec -i -u postgres idraft-postgres psql -d idraft << 'SQL'
UPDATE ops.collection_tasks
SET state = 'failed',
    error_message = 'Timed out by operator: stalled past collection window',
    updated_at = NOW()
WHERE state IN ('dispatched', 'processing')
  AND dispatched_at < NOW() - INTERVAL '4 hours';
SQL
```

### Remediation C: Purge Corrupt Messages from Broker

If a poisonous message causes the worker to repeatedly crash on deserialization:

```bash
# Caution: only purge after inspecting dead letter tasks
docker exec idraft-redis redis-cli -a "<worker_password>" DEL "taskiq:collect"
```

# Runbook: Restarting a Service

This runbook covers how to restart an individual container or the entire Docker Compose stack on the production host.

## Prerequisites

- SSH access to the host as the deploy user or root
- Compose configuration at `/srv/idraft/infra/compose/docker-compose.yml`
- Environment file at `/etc/idraft/.env`

## Restart an Individual Service

To restart a single service without affecting others:

```bash
cd /srv/idraft/infra/compose
docker compose --env-file /etc/idraft/.env restart <service>
```

Available service names:
- `caddy` (reverse proxy)
- `web` (Next.js frontend)
- `api` (FastAPI backend)
- `worker` (Taskiq background worker)
- `postgres` (PostgreSQL 18 database)
- `redis` (Redis 8 cache and task queue broker)

### Verify Service Health

Wait 10 to 30 seconds for the healthcheck to run, then check status:

```bash
docker inspect --format '{{.State.Status}} ({{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}})' idraft-<service>
```

View the service logs:

```bash
docker compose --env-file /etc/idraft/.env logs -f --tail 100 <service>
```

## Restart the Entire Stack

If a full stack restart is needed, restart in dependency order:

```bash
cd /srv/idraft/infra/compose

# 1. Restart database and broker
docker compose --env-file /etc/idraft/.env restart postgres redis

# 2. Wait for postgres and redis to report healthy
until [ "$(docker inspect -f '{{.State.Health.Status}}' idraft-postgres 2>/dev/null)" = "healthy" ]; do
  echo "Waiting for postgres..."
  sleep 2
done

until [ "$(docker inspect -f '{{.State.Health.Status}}' idraft-redis 2>/dev/null)" = "healthy" ]; do
  echo "Waiting for redis..."
  sleep 2
done

# 3. Restart application services
docker compose --env-file /etc/idraft/.env restart api worker web caddy
```

## Health Verification

Confirm all containers report healthy:

```bash
docker compose --env-file /etc/idraft/.env ps
curl -fsS https://app.idraft.ai/api/readyz
```

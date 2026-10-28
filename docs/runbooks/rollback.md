# Runbook: Rolling Back a Release

This runbook covers how to roll back a failed deployment to the previously known good release.

## Architecture and Guarantees

Deployments on idraft.ai reference explicit container image digests from GitHub Packages (GHCR). Whenever a deployment completes successfully, its digests are recorded in `/srv/idraft/releases/previous.json`.

If a deployment fails health checks during execution of `infra/deploy.sh`, an automatic rollback to `previous.json` triggers immediately.

## Manual Rollback Procedure

If a release is deployed successfully but exhibits runtime regressions or critical defects, trigger a manual rollback:

```bash
cd /srv/idraft
./infra/deploy.sh --rollback
```

### What This Command Does

1. Verifies `/srv/idraft/releases/previous.json` exists and is readable.
2. Extracts the previous image digests (`API_IMAGE`, `WORKER_IMAGE`, `WEB_IMAGE`).
3. Pulls the previous images by digest.
4. Updates containers in order: `api`, `worker`, `web`, `caddy`.
5. Waits for healthchecks to report healthy.
6. Calls `/api/readyz` via Caddy.
7. Appends a `ROLLBACK` record to `/srv/idraft/releases/history.log`.

## Database Compatibility Rule

Rollbacks do not downgrade database schema migrations. Schema migrations must always follow the expand-contract pattern:
- The new database schema must remain backwards compatible with the previous application release.
- Column removals or destructive schema renames are performed only in subsequent releases after old application versions are decommissioned.

## Verification

After the rollback completes:

```bash
# 1. Verify container status and health
docker compose -f /srv/idraft/infra/compose/docker-compose.yml --env-file /etc/idraft/.env ps

# 2. Check public endpoint health
curl -fsS https://app.idraft.ai/api/readyz

# 3. Check application sign-in page
curl -kI https://app.idraft.ai/login
```

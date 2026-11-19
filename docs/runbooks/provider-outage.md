# Runbook: Handling Provider Outages

This runbook covers procedures when external upstream services experience outages or elevated failure rates.

## External Dependency Inventory

idraft.ai interacts with the following external providers:

1. DataForSEO: SERP keyword rank collection and AI Overview data
2. Cloudflare R2: object storage for raw SERP payloads (`seo-raw`) and database backups (`seo-backups`)
3. Brevo: transactional magic link sign-in emails
4. Better Stack: external uptime monitoring of `https://app.idraft.ai`
5. Healthchecks.io: dead-man heartbeats for worker tick, backups, and host check

## Provider 1: DataForSEO Outage

### Symptoms
- Worker logs show HTTP 5xx responses, connection timeouts, or socket errors when calling `api.dataforseo.com`.
- `taskiq:collect` queue depth grows.
- Collection runs remain in `running` status past their scheduled window.

### Impact
- Live user traffic on `app.idraft.ai` is unaffected.
- Fresh rank snapshots will be delayed until provider recovers.

### Action Plan
1. Check DataForSEO status page and announcements.
2. Confirm account balance has not hit zero (insufficient funds return HTTP 402/400).
3. The worker has built-in retry backoff with jitter for polling `tasks_ready`. Let the worker queue absorb transient outages.
4. If the outage exceeds 6 hours, pause active schedules to prevent queue flooding:
   ```bash
   docker exec -i -u postgres idraft-postgres psql -d idraft << 'SQL'
   UPDATE ops.schedules SET is_active = false WHERE is_active = true;
   SQL
   ```
5. Once DataForSEO restores service, re-enable schedules:
   ```bash
   docker exec -i -u postgres idraft-postgres psql -d idraft << 'SQL'
   UPDATE ops.schedules SET is_active = true WHERE is_active = false;
   SQL
   ```

## Provider 2: Cloudflare R2 Outage

### Symptoms
- Worker errors during raw payload uploads: `S3UploadFailed` or `EndpointConnectionError`.
- Nightly backup `infra/backup/pg-backup.sh` fails with exit code 3 and pings Healthchecks `/fail`.

### Impact
- Ingestion of SERP data pauses if raw payloads cannot be committed to `seo-raw`.
- Database backups to `seo-backups` fail.

### Action Plan
1. Verify Cloudflare system status (specifically R2 Storage in region WNAM/ENAM).
2. For backups: if R2 is unavailable, run a manual local backup to a secure host directory:
   ```bash
   mkdir -p /root/emergency-backups
   chmod 700 /root/emergency-backups
   docker exec -u postgres idraft-postgres pg_dump -U backup -d idraft --format=custom --compress=zstd:level=6 > /root/emergency-backups/idraft-manual-$(date +%F).pgdump
   ```
3. Once R2 returns to service, re-run `infra/backup/pg-backup.sh` to produce a fresh encrypted remote backup.

## Provider 3: Brevo Outage

### Symptoms
- Sign-in attempts fail with "Failed to send login email".
- Error logs in `api`: `BrevoAPIError` or timeout connecting to `api.brevo.com`.

### Impact
- Users cannot receive magic links or invitations to sign in. Existing authenticated sessions remain active.

### Action Plan
1. Check Brevo status page.
2. For critical operational access during an outage, an operator can generate a session or verify an existing user account directly via the CLI:
   ```bash
   docker exec -it idraft-api python -m idraft.cli create-operator --email operator@example.com --name "Operator"
   ```
3. Resume normal sign-in flow once Brevo operational status is confirmed.

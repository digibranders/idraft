# Runbook: Secret Rotation

This runbook documents how to safely rotate credentials, API keys, and database passwords for idraft.ai.

## Secret Custody and Flow

All production secrets originate in the GitHub repository Environment named `production`. During deployment, `.github/workflows/deploy.yml` transmits secrets over an encrypted SSH connection to `/etc/idraft/.env` (mode 0600, owned by root).

Never commit secrets to git or store them in container images.

## Rotating Third-Party API Keys

### 1. Brevo Email API Key (`EMAIL_API_KEY`)

1. Generate a new API key in the Brevo dashboard under Account > SMTP and API.
2. Update the `EMAIL_API_KEY` secret in the GitHub `production` Environment.
3. Trigger a redeploy workflow or update `/etc/idraft/.env` on the host:
   ```bash
   sed -i 's/^EMAIL_API_KEY=.*/EMAIL_API_KEY=your_new_key/' /etc/idraft/.env
   cd /srv/idraft/infra/compose
   docker compose --env-file /etc/idraft/.env up -d api
   ```
4. Verify by requesting a test magic link email on `https://app.idraft.ai/login`.
5. Revoke the old key in the Brevo dashboard.

### 2. Cloudflare R2 Access Keys (`R2_RAW_ACCESS_KEY_ID`, `R2_RAW_SECRET_ACCESS_KEY`)

1. In Cloudflare Dashboard > R2 > Manage R2 API Tokens, create a replacement token scoped to `seo-raw`.
2. Update the secrets in the GitHub `production` Environment.
3. Update `/etc/idraft/.env` and restart the worker:
   ```bash
   docker compose -f /srv/idraft/infra/compose/docker-compose.yml --env-file /etc/idraft/.env up -d worker
   ```
4. Check worker logs to ensure R2 connectivity:
   ```bash
   docker compose -f /srv/idraft/infra/compose/docker-compose.yml --env-file /etc/idraft/.env logs --tail 50 worker
   ```
5. Revoke the retired token in Cloudflare.

### 3. DataForSEO Credentials (`DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`)

1. Update credentials in DataForSEO and update the GitHub Environment secrets.
2. Update `/etc/idraft/.env` and restart `worker`.

## Rotating PostgreSQL Role Passwords

PostgreSQL roles (`migrator`, `api`, `worker`) are authenticated with SCRAM-SHA-256 passwords.

To rotate a password (for example `api`):

1. Generate a strong random password:
   ```bash
   openssl rand -hex 32
   ```
2. Connect to the database as superuser:
   ```bash
   docker exec -it idraft-postgres psql -U postgres -d idraft
   ```
3. Update the role password:
   ```sql
   ALTER ROLE api WITH PASSWORD 'new_generated_password';
   ```
4. Update the corresponding `DATABASE_URL` and `PG_API_PASSWORD` in `/etc/idraft/.env` and in GitHub Environment secrets.
5. Restart the dependent services:
   ```bash
   cd /srv/idraft/infra/compose
   docker compose --env-file /etc/idraft/.env up -d api
   ```
6. Verify `/api/readyz` returns HTTP 200.

## Critical Warning: TOTP Encryption Key (`TOTP_ENCRYPTION_KEY`)

Do not regenerate or change `TOTP_ENCRYPTION_KEY` without an offline data re-encryption script. The TOTP key encrypts stored two-factor authentication secrets in the database. Regenerating this key will permanently invalidate stored two-factor authentication credentials for all users.

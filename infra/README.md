# Production Infrastructure and Operations Runbook

This directory contains the production Docker Compose stack, configuration files, host bootstrap script, and deployment automation for `app.idraft.ai`.

## Architecture Overview

The production runtime is a single host running Ubuntu 24.04 LTS with Docker Engine and the Compose plugin:

* **Edge Gateway (`caddy`):** Caddy 2 reverse proxy. Handles automatic TLS certificates for `app.idraft.ai` via Let's Encrypt / ZeroSSL. The only container exposing public ports (80 and 443). Internal endpoints such as `/api/readyz` are blocked from public access.
* **Frontend (`web`):** Next.js standalone application running on Node 24 slim under uid 1000:1000. Proxied at `/` by Caddy. Communicates internally with `api:8000` via `API_INTERNAL_ORIGIN`.
* **API Backend (`api`):** FastAPI application on Python 3.13 running under uid 10001:10001 with Uvicorn. Proxied at `/api/*` by Caddy. Connects to PostgreSQL as `app_api` and Redis as `app`.
* **Background Worker (`worker`):** Taskiq worker on Python 3.13 running under uid 10001:10001. Handles scheduled collection, DataForSEO sync, and raw payload storage in Cloudflare R2. Connects to PostgreSQL as `app_worker` and Redis as `app`.
* **Database (`postgres`):** PostgreSQL 18. Tuned for a 15 GB RAM host (`shared_buffers=3GB`, `effective_cache_size=9GB`, `work_mem=16MB`, `maintenance_work_mem=512MB`). Internal network only; publishes no ports to the host.
* **Cache and Message Broker (`redis`):** Redis 8 with append-only file (AOF) persistence and ACL enforcement (`app`, `healthcheck`, `admin` users). Sized to 512 MB `maxmemory` with `noeviction`. Internal network only; publishes no ports.
* **Database Migrator (`migrator`):** Short-lived one-off container running Alembic migrations as role `migrator` before updated application containers are started.

## Host Bootstrap

The host bootstrap script configures a fresh Ubuntu 24.04 server into an operational container host.

### Prerequisites

* Clean Ubuntu 24.04 LTS VPS with at least 8 GB RAM (15 GB recommended).
* Root access via SSH.
* Public IPv4 pointing to the host's DNS name (`app.idraft.ai`).

### Running the Bootstrap Script

1. Copy `infra/bootstrap.sh` to the server:
   ```bash
   scp infra/bootstrap.sh root@<SERVER_IP>:/tmp/bootstrap.sh
   ```
2. Run the script as root:
   ```bash
   ssh root@<SERVER_IP> "bash /tmp/bootstrap.sh"
   ```

### What Bootstrap Configures

* **Docker Engine & Compose:** Installs official Docker CE and Compose plugin from Docker apt repository.
* **System user:** Creates unprivileged `deploy` user with key-based authentication and membership in the `docker` group.
* **Directory structure:** Prepares `/srv/idraft`, `/srv/idraft/releases`, `/srv/idraft/infra`, and `/etc/idraft`.
* **Swap space:** Allocates 2 GB swap file at `/swapfile` with `vm.swappiness=10`.
* **System limits:** Configures `fs.file-max=2097152` and `vm.max_map_count=262144`.
* **Firewall (UFW):** Restricts ingress traffic to ports 22 (SSH), 80 (HTTP), and 443 (HTTPS) only.
* **Intrusion prevention:** Enables `fail2ban` for SSH brute force mitigation.
* **Automatic security updates:** Configures `unattended-upgrades` with automatic reboot window at 04:00 UTC if required.
* **SSH hardening:** Disables root password login and enforces key-only authentication.

The bootstrap script is idempotent. Running it multiple times will not overwrite existing state or disrupt running services.

## Deployment

Deployments are automated through GitHub Actions or can be executed directly on the host using `infra/deploy.sh`.

### Automated Deployment (GitHub Actions)

The workflow `.github/workflows/deploy.yml` runs on push to `main` (after `backend.yml` and `web.yml` pass) or can be triggered manually via `workflow_dispatch`.

1. The job enters the `production` GitHub Environment, which requires manual approval from an authorized reviewer.
2. The workflow downloads the image digest artifacts (`backend-digests.json` and `web-digests.json`) produced by CI.
3. Over SSH, the workflow writes `/etc/idraft/.env` atomically with mode 0600 from GitHub Environment secrets.
4. The workflow rsyncs `infra/` to `/srv/idraft/infra/` and copies `digests.json`.
5. The host executes `/srv/idraft/infra/deploy.sh /etc/idraft/.env /srv/idraft/digests.json`.

### Manual Deployment on the Host

To deploy manually using specific image digests:

1. Create a `digests.json` file:
   ```json
   {
     "api": "ghcr.io/digibranders/idraft-api@sha256:<digest>",
     "worker": "ghcr.io/digibranders/idraft-worker@sha256:<digest>",
     "web": "ghcr.io/digibranders/idraft-web@sha256:<digest>"
   }
   ```
2. Run the deploy script:
   ```bash
   sudo /srv/idraft/infra/deploy.sh /etc/idraft/.env /path/to/digests.json
   ```

### Deployment Step Sequence

The deploy script executes the following stages in strict order:
1. Pulls all three container images by digest from GHCR.
2. Computes SHA-256 password hashes from `/etc/idraft/.env` and renders the Redis ACL file.
3. Runs the database migrator container (`alembic upgrade head`) to completion.
4. Records the current active release in `/srv/idraft/releases/previous.json`.
5. Starts application services in order: `api`, `worker`, `web`, `caddy`.
6. Waits for each service healthcheck to report healthy.
7. Verifies internal readiness via `/api/readyz`.
8. On success, records release metadata in `/srv/idraft/releases/history.log`.
9. On any failure, automatically triggers rollback to the previous release recorded in `previous.json`.

## Rollback

Rollback is a single command that immediately redeploys the previous release without touching the database schema.

### Manual Rollback Command

```bash
sudo /srv/idraft/infra/deploy.sh --rollback /etc/idraft/.env
```

You can also trigger rollback via GitHub Actions by running `deploy.yml` with `workflow_dispatch` and setting `rollback: true`.

### Forward-Only Migrations Rule

Database migrations are strictly forward-only. Rollback redeploys the previous container images against the current database schema. Therefore, all migrations must follow the expand then contract pattern:

* **Expand:** Add new columns as nullable or with defaults; create new tables; add indexes concurrently.
* **Deploy:** Application code is deployed that supports both structures.
* **Contract:** In a subsequent release, drop deprecated columns or apply not-null constraints after older code is no longer running.

Never rename columns, drop active columns, or introduce restrictive NOT NULL constraints in a single release.

## Creating the First Platform Operator

New installations run with `REGISTRATION=invited` by default. The initial administrative operator account must be created from the command line on the host.

Run the following command on the server using the migrator credentials:

```bash
cd /srv/idraft/infra/compose
sudo docker compose --env-file /etc/idraft/.env run --rm \
  -e DATABASE_URL="${DATABASE_URL_MIGRATOR}" \
  api python -m idraft.cli create-operator --email operator@idraft.ai --name "Platform Admin"
```

The command prompts interactively for a secure password (minimum 12 characters). It connects as role `migrator` and creates a verified user with platform operator privileges.

After creating the operator:
1. Navigate to `https://app.idraft.ai/login`.
2. Sign in with the configured email and password.
3. Configure the first workspace, timezone, and project.
4. Invite additional team members via workspace settings.

## Secrets Catalog

All production secrets must be stored in the GitHub Actions `production` Environment or managed in team password managers. Never commit secrets to the repository.

| Secret Name | Destination / Usage | Source / Description |
|---|---|---|
| `DEPLOY_HOST` | GitHub Actions | Public IP or DNS hostname of the production Droplet. |
| `DEPLOY_USER` | GitHub Actions | Deploy username (`deploy`). |
| `DEPLOY_SSH_KEY` | GitHub Actions | Private Ed25519 SSH key authorized on the production host. |
| `ENV_FILE` | `/etc/idraft/.env` | Complete multi-line environment configuration containing all stack secrets. |
| `PG_SUPERUSER_PASSWORD` | PostgreSQL | Initial password for the `postgres` administrative role. |
| `PG_API_PASSWORD` | PostgreSQL / API | Password for `app_api` role. Subject to row-level security. |
| `PG_WORKER_PASSWORD` | PostgreSQL / Worker | Password for `app_worker` role. Cross-tenant worker access. |
| `PG_MIGRATOR_PASSWORD` | PostgreSQL / Migrator | Password for `migrator` role. Schema owner for Alembic. |
| `DATABASE_URL_API` | `/etc/idraft/.env` | `postgresql://app_api:<pass>@postgres:5432/idraft` |
| `DATABASE_URL_WORKER` | `/etc/idraft/.env` | `postgresql://app_worker:<pass>@postgres:5432/idraft` |
| `DATABASE_URL_MIGRATOR` | `/etc/idraft/.env` | `postgresql://migrator:<pass>@postgres:5432/idraft` |
| `REDIS_PASSWORD_APP` | Redis / API / Worker | Password for `app` user in Redis ACL. |
| `REDIS_PASSWORD_HEALTHCHECK` | Redis / Healthcheck | Password for `healthcheck` user (ping only) in Redis ACL. |
| `REDIS_PASSWORD_ADMIN` | Redis / Admin | Password for `admin` user in Redis ACL. |
| `REDIS_URL_APP` | `/etc/idraft/.env` | `redis://app:<pass>@redis:6379/0` |
| `TOTP_ENCRYPTION_KEY` | Backend API / Worker | Base64-encoded 32-byte secret for encrypting MFA keys at rest. Must NEVER be changed or regenerated once users exist, or all stored TOTP secrets will be corrupted. |
| `EMAIL_PROVIDER` | Backend API | Transactional email provider (`brevo`, `resend`, or `console`). |
| `EMAIL_API_KEY` | Backend API | API key for Brevo transactional email delivery. |
| `EMAIL_FROM` | Backend API | Verified sender address (e.g. `hello@idraft.ai`). |
| `DATAFORSEO_LOGIN` | Worker | DataForSEO API account username or email. |
| `DATAFORSEO_PASSWORD` | Worker | DataForSEO API account password. |
| `R2_RAW_ENDPOINT` | Worker / API | Cloudflare R2 S3 endpoint URL (`https://<account-id>.r2.cloudflarestorage.com`). |
| `R2_RAW_BUCKET` | Worker / API | S3 bucket name for raw SERP and AI snapshots (`seo-raw`). |
| `R2_RAW_ACCESS_KEY_ID` | Worker / API | Cloudflare R2 API token access key ID with read/write access to `seo-raw`. |
| `R2_RAW_SECRET_ACCESS_KEY` | Worker / API | Cloudflare R2 API token secret key. |
| `SENTRY_DSN_BACKEND` | Backend API / Worker | Sentry error tracking DSN for Python applications. |
| `SENTRY_DSN_WEB` | Web Frontend | Sentry error tracking DSN for Next.js web application. |

## Routine Maintenance

### Checking Stack Status

```bash
cd /srv/idraft/infra/compose
sudo docker compose --env-file /etc/idraft/.env ps
```

### Inspecting Container Logs

```bash
sudo docker compose --env-file /etc/idraft/.env logs -f --tail=100 api
sudo docker compose --env-file /etc/idraft/.env logs -f --tail=100 worker
sudo docker compose --env-file /etc/idraft/.env logs -f --tail=100 caddy
```

### Pruning Unused Images

After multiple deployments, old unreferenced images can be pruned:

```bash
sudo docker image prune -a --filter "until=168h" -f
```

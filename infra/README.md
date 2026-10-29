# Production Infrastructure and Operations Runbook

This directory contains the production Docker Compose stack, configuration files, host bootstrap script, and deployment automation for `app.idraft.ai`.

## Architecture Overview

The production runtime is a single host running Ubuntu 24.04 LTS with Docker Engine and the Compose plugin:

* **Edge Gateway (`caddy`):** Caddy 2 reverse proxy. Handles automatic TLS certificates for `app.idraft.ai` via Let's Encrypt / ZeroSSL. The only container publishing ports (80 and 443, both variables, see below). `/api/internal/*` is answered with 404. `/api/readyz` is public on purpose, see "Public readiness endpoint".
* **Frontend (`web`):** Next.js standalone application running on Node 24 slim under uid 1000:1000. Proxied at `/` by Caddy. Communicates internally with `api:8000` via `API_INTERNAL_ORIGIN`.
* **API Backend (`api`):** FastAPI application on Python 3.13 running under uid 10001:10001 with Uvicorn. Proxied at `/api/*` by Caddy. Trusts `X-Forwarded-*` headers only from the edge network subnet. Connects to PostgreSQL as `app_api` and Redis as `app`.
* **Background Worker (`worker`):** Taskiq worker on Python 3.13 running under uid 10001:10001. Handles scheduled collection, DataForSEO sync, and raw payload storage in Cloudflare R2. Connects to PostgreSQL as `app_worker` and Redis as `app`.
* **Database (`postgres`):** PostgreSQL 18. Tuned for a 15 GB RAM host (`shared_buffers=3GB`, `effective_cache_size=9GB`, `work_mem=16MB`, `maintenance_work_mem=512MB`). Internal network only; publishes no ports to the host.
* **Cache and Message Broker (`redis`):** Redis 8 with append-only file (AOF) persistence and ACL enforcement (`app`, `healthcheck`, `admin` users). Sized to 512 MB `maxmemory` with `noeviction`. Internal network only; publishes no ports.
* **Database Migrator (`migrator`):** Short-lived one-off container running the migrations as role `migrator` before updated application containers are started.

Containers have no fixed names, IPs or subnets. Compose names them `<project>-<service>-1`; scripts find them with `docker compose ps -q <service>`. Host ports and the two network subnets are variables (`HTTP_PORT`, `HTTPS_PORT`, `EDGE_SUBNET`, `BACKEND_SUBNET`), so a second project can run beside the first with its own `COMPOSE_PROJECT_NAME`.

### Configuration files are mounted as directories

`compose/caddy/`, `compose/postgres/conf/` and `compose/redis/conf/` are each mounted read-only as a whole directory (`/etc/caddy`, `/etc/postgresql`, `/etc/redis`). The infra tree is installed by `rsync`, which replaces a file with a new inode, and a single-file bind mount would keep showing the deleted old file until the container is recreated. What a changed file does after a deploy:

* **Caddyfile:** `deploy.sh` runs `caddy reload` after the services are healthy, so a change is served at once, without a restart (and `caddy reload` does nothing when the config is identical). A rejected Caddyfile fails the deploy and restores the previous release's containers; the invalid file stays on disk, and the running Caddy keeps its last good config.
* **`postgresql.conf`, `pg_hba.conf`, `pg_ident.conf`, `redis.conf`:** read at the next start of that container. `deploy.sh` does not restart the databases for a config edit. Apply one by hand when you want it: `SELECT pg_reload_conf();` for the settings Postgres can reload, otherwise restart the service in a maintenance window.

Rollback restores container images and the env, not these files: they always come from the commit that was last installed.

### Public readiness endpoint

`/api/readyz` is reachable from the internet through Caddy, and nothing else under `/api/internal` is. The decision rests on the handler in `backend/src/idraft/api/health.py`: it returns `{"status": ..., "checks": {"postgres": bool, "redis": bool, "migrations": bool}}`, never a version, hostname or error text. The external uptime check planned for WP6 needs it. The cost is that anyone can learn whether the stack is up. If that is not acceptable, put `/api/readyz` back into the `@internal` matcher in `compose/caddy/Caddyfile` and point the uptime check at a Caddy health route instead.

## Host Bootstrap

The host bootstrap script configures a fresh Ubuntu 24.04 server into an operational container host.

### Prerequisites

* Clean Ubuntu 24.04 LTS VPS with at least 8 GB RAM (15 GB recommended).
* Root access via SSH, with your own public key already in `/root/.ssh/authorized_keys`.
* Public IPv4 pointing to the host's DNS name (`app.idraft.ai`).
* A dedicated Ed25519 key pair for CI (`ssh-keygen -t ed25519 -f idraft-deploy -C idraft-deploy`). The public half goes to the host, the private half becomes the `DEPLOY_SSH_KEY` secret.

### Running the Bootstrap Script

The script installs helper programs from `infra/host/`, so copy the whole directory:

1. Copy `infra/` and the CI public key to the server:
   ```bash
   scp -r infra idraft-deploy.pub root@<SERVER_IP>:/root/
   ```
2. Run the script as root, first without hardening:
   ```bash
   ssh root@<SERVER_IP> "bash /root/infra/bootstrap.sh --deploy-key /root/idraft-deploy.pub"
   ```
3. Check that both logins work with keys: `ssh root@<SERVER_IP>` and `ssh -i idraft-deploy deploy@<SERVER_IP>`.
4. Then harden SSH (key-only login, no root password):
   ```bash
   ssh root@<SERVER_IP> "bash /root/infra/bootstrap.sh --deploy-key /root/idraft-deploy.pub --harden-ssh"
   ```
   The script refuses to harden unless both `/root/.ssh/authorized_keys` and the deploy user's `authorized_keys` hold a key.

Re-running the script with the same arguments changes nothing and restarts nothing. Re-run it after changing `infra/host/*`, because those helpers are installed once into `/usr/local/sbin`, not by the deploy pipeline. An `idraft-install-env` from before `idraft-check-env` existed stages any env until bootstrap is re-run; `deploy.sh`, which the pipeline installs, refuses such an env at deploy time in the meantime. It creates `/srv/idraft` and `/etc/idraft` and their subdirectories only when missing, with the intended owner and mode, and prints "Left alone" for each one that exists, so it can be run on a live host without re-owning or re-moding a directory the stack uses.

### What Bootstrap Configures

* **Docker Engine & Compose:** Installs official Docker CE and Compose plugin from Docker apt repository. `/etc/docker/daemon.json` is rewritten, and Docker restarted, only when its content changes.
* **Deploy user:** Creates unprivileged `deploy` with the CI public key as its only authorized key. It is not in the `docker` group (bootstrap removes it if an earlier run added it): every Docker call goes through the root-owned scripts it may run with `sudo`.
* **Sudo:** `/etc/sudoers.d/idraft-deploy` (mode 0440, checked with `visudo -cf` before install) lets `deploy` run exactly five commands as root, without a password:
  * `/usr/local/sbin/idraft-ghcr-login` (no arguments): reads a GitHub user name and a token from stdin and runs `docker login ghcr.io --password-stdin` for root.
  * `/usr/local/sbin/idraft-install-env` (no arguments): stages `/etc/idraft/.env.next` from stdin (root, 0600). `deploy.sh` promotes it to `.env` only after the release serves. It first runs `/usr/local/sbin/idraft-check-env` on the input and refuses, staging nothing, unless: `CADDY_IMAGE`, `POSTGRES_IMAGE` and `REDIS_IMAGE` are absent or the official `caddy`, `postgres` and `redis` images pinned by digest (`name[:tag]@sha256:<64 hex>`); no other `*_IMAGE` is set (`API_IMAGE`, `WORKER_IMAGE` and `WEB_IMAGE` are allowed but ignored, since `deploy.sh` exports the release digests over them); `REDIS_ACL_DIR`, the only host path the Compose file takes from the env, is exactly `/etc/idraft/redis`; no `COMPOSE_*` or `DOCKER_*` variable is set; and every line is a plain `KEY=value` (no `export`, no spaces around `=`, no quotes, no inline comment, no `$`). `deploy.sh` runs the same check on the env it deploys with, so a file that reached `/etc/idraft` another way is refused too.
  * `/usr/local/sbin/idraft-install-infra` (no arguments): copies the staged infra files into `/srv/idraft/infra`. Root never reads the stage: the rsync sender runs as the owner of `/srv/idraft/incoming` (through `runuser`), so a link in the stage, or the stage swapped for a link, reaches only what `deploy` could read itself. Root receives into a private snapshot and installs from there.
  * `/srv/idraft/infra/deploy.sh /etc/idraft/.env /srv/idraft/incoming/digests.json`
  * `/srv/idraft/infra/deploy.sh --rollback /etc/idraft/.env`
* **Directory structure:** `/srv/idraft`, `releases`, `infra` and `shared` are root-owned; the deploy user cannot edit anything sudo may run. `/srv/idraft/incoming` is the only place `deploy` can write (mode 0700), used to stage uploads. `/etc/idraft` is root-only (0700).
* **Swap space:** Allocates 2 GB swap file at `/swapfile` with `vm.swappiness=10`.
* **Kernel settings:** `vm.overcommit_memory=1` for Redis and socket backlog limits, in `/etc/sysctl.d/60-idraft.conf`.
* **Firewall (UFW):** Denies inbound traffic except 80, 443 (TCP and UDP) and the port `sshd -T` reports. A non-default SSH port is read from the running configuration, not assumed.
* **Intrusion prevention:** Enables `fail2ban` for SSH brute force mitigation.
* **Automatic security updates:** Configures `unattended-upgrades` with automatic reboot at 04:30 if required.
* **SSH hardening (only with `--harden-ssh`):** key-only authentication, `PermitRootLogin prohibit-password`, no forwarding.

Security note: the deploy user has no Docker access of its own, and can run only the five sudo commands above, all root-owned and not writable by it. That is a narrower blast radius than `docker` group membership (which is root), but not a small one: a compromised deploy key can still stage an env file and infra files that root-run scripts then use, so it can run its own code as root through the next deploy. The narrow rule keeps the intended path honest and the audit trail clear; it does not make the key low-privilege. Protect `DEPLOY_SSH_KEY` accordingly (environment secret with a required reviewer, rotate on any doubt).

The `production` GitHub Environment must restrict **deployment branches to `main`** (Settings, Environments, production, Deployment branches and tags, Selected branches: `main`) and keep a required reviewer. Without the branch rule, a workflow run on any branch that can edit `deploy.yml` could read the environment's secrets once a reviewer approves.

Caddy publishes on `0.0.0.0` only (see `ports` in `compose/docker-compose.yml`): nothing listens on IPv6. Do not publish an `AAAA` record for the domain until the stack is changed to bind `[::]` too; a client that prefers IPv6 would otherwise time out before falling back to IPv4.

## Deployment

Deployments are automated through GitHub Actions or can be executed directly on the host using `infra/deploy.sh`.

### Automated Deployment (GitHub Actions)

The workflow `.github/workflows/deploy.yml` runs after the `backend` or `web` workflow succeeds on a push to `main` in this repository (never for a pull request or a fork), or manually via `workflow_dispatch`.

1. The job enters the `production` GitHub Environment, which requires manual approval from an authorized reviewer.
2. It checks out the commit that was built (`workflow_run.head_sha`) without persisted credentials.
3. `infra/ci/resolve-release.sh` builds the release record:
   * It first asks for the tip of `main`. If the tip is not the commit that was built and a file changed since then that one of the two image workflows watches (their `on.push.paths`), this run would be a step backwards: the job ends without deploying, and the newer commit's own workflows deploy. A newer commit that changes only docs or `infra/` does not block the deploy.
   * It downloads the digest artifact of the triggering run by run id, and the other workflow's digests for the same commit. If a path filter kept the other workflow from running for that commit, its newest successful run on `main` is used, but only when that commit is an ancestor **and** no file that workflow watches changed between the two commits (the compare API's file list is checked against its path filters; otherwise the job fails, because the images would not match the code).
   * If the other workflow is still running for the commit, or was cancelled (a newer push cancelled it), the job ends without deploying; the completion of that workflow, or of the newer run, triggers the deploy. If it failed, the job fails.
   * An expired or missing artifact fails with a message that says to re-run the workflow or deploy by hand.
   * Every image must match `ghcr.io/digibranders/idraft-(api|worker|web)@sha256:<64 hex>`. The `sha` in the record is the pushed commit for a `workflow_run`; for a manual run it is read from the `org.opencontainers.image.revision` label of the three images (set by `backend.yml` and `web.yml`; images older than that change cannot be deployed manually until rebuilt). If the three labels name different commits, the newest is recorded when all the others are its ancestors, otherwise the run fails.

   The decision logic is exercised offline by `bash infra/test/resolve-release.sh` (fake `gh` and `docker` answering from fixtures shaped like the API responses; it also runs in the `infra` workflow). The real `gh`, the registry and GitHub's exact path glob rules are not covered: the script treats `*` as also matching `/`, which can only skip or fail more often, never deploy a stale release.
4. Over SSH with a pinned host key, the workflow streams `ENV_FILE` to `sudo /usr/local/sbin/idraft-install-env` (it lands as `/etc/idraft/.env.next`, never over the live `.env`), stages `infra/` in `/srv/idraft/incoming/infra`, runs `sudo /usr/local/sbin/idraft-install-infra`, uploads `digests.json` to `/srv/idraft/incoming/` and runs `sudo /srv/idraft/infra/deploy.sh /etc/idraft/.env /srv/idraft/incoming/digests.json`.

A manual run needs all three image references as inputs (the runner logs in to GHCR with its own token to read their labels). Tick `rollback` to run the rollback command instead.

#### Environment secrets used by the workflow

| Secret | Content |
|---|---|
| `DEPLOY_HOST` | Public IP or DNS name of the host. |
| `DEPLOY_USER` | `deploy` (the default when unset). |
| `DEPLOY_SSH_KEY` | Private Ed25519 key whose public half was passed to `bootstrap.sh --deploy-key`. |
| `DEPLOY_KNOWN_HOSTS` | The host's public key line(s) in `known_hosts` format. The job fails if it is empty and uses `StrictHostKeyChecking=yes`, so it never trusts a first connection. |
| `GHCR_PULL_USER` | The GitHub user the pull token belongs to. |
| `GHCR_PULL_TOKEN` | A token that lets the host pull the private `idraft-*` images. See "Registry login" below. |
| `ENV_FILE` | The full contents of the next `/etc/idraft/.env`. It is deployed as a candidate and becomes the live `.env` only after the release serves. |

#### Registry login

The images in GHCR are private, and nothing else logs the host in, so the workflow does it on every deploy, before `deploy.sh` runs: it pipes `GHCR_PULL_USER` and `GHCR_PULL_TOKEN` over SSH to `sudo /usr/local/sbin/idraft-ghcr-login`, which runs `docker login ghcr.io --username <user> --password-stdin` for root (credentials in `/root/.docker/config.json`, mode 0600). The token is never on a command line.

* Create it as a **read-only** token: a classic personal access token with only the `read:packages` scope (or a fine-grained token with only package read access to this repository's packages), owned by a machine or service user that has read access to the `idraft-*` packages. It must not be able to push, and it must not be anyone's everyday personal token.
* It **expires**. Give it an expiry (for example 90 days) and put the date in the team calendar. An expired token makes the login step fail with `unauthorized`, before the host is changed; rotate it by updating the `GHCR_PULL_TOKEN` secret and re-running the deploy.
* `/root/.docker/config.json` keeps the last token until the next login; delete it with `sudo docker logout ghcr.io` when retiring the host.

Produce `DEPLOY_KNOWN_HOSTS` once, from your own machine, and compare the fingerprint with the provider console or with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` run on the host:

```bash
ssh-keyscan -t ed25519 <SERVER_IP_OR_NAME>
```

Paste the output line into the secret. Use the same name as `DEPLOY_HOST`. After a host rebuild the key changes, and the secret must be updated.

### Manual Deployment on the Host

To deploy manually using specific image digests:

1. Create a `digests.json` file (a `sha` field with the 40 character commit is optional; without it a short hash of the three references becomes `RELEASE_SHA`):
   ```json
   {
     "api": "ghcr.io/digibranders/idraft-api@sha256:<digest>",
     "worker": "ghcr.io/digibranders/idraft-worker@sha256:<digest>",
     "web": "ghcr.io/digibranders/idraft-web@sha256:<digest>"
   }
   ```
2. Run the deploy script as root:
   ```bash
   sudo /srv/idraft/infra/deploy.sh /etc/idraft/.env /path/to/digests.json
   ```

If `/etc/idraft/.env.next` exists, the script deploys with it (and says so); delete it first to redeploy on the live `.env`. Tags such as `idraft-api:latest` are refused. Only the local tests set `IDRAFT_ALLOW_TAGS=1`, and `sudo` strips that variable.

### Rules for `/etc/idraft/.env`

Both Compose and `deploy.sh` read this file, and the first-operator command below sources it with a shell. Write one `KEY=value` per line, with no quotes, no inline comments and no spaces around `=`. `deploy.sh` refuses a quoted value, an inline comment, or a value containing `$` (Compose would interpolate it, and the Redis ACL hashes deploy.sh computes would no longer match the password the services use). Secrets must be alphanumeric or URL-safe: generate them with `openssl rand -hex 24`.

Three files belong together under `/etc/idraft`:

| File | Content |
|---|---|
| `.env` | The environment of the release that is serving. |
| `.env.next` | A candidate staged by CI. `deploy.sh` validates it, deploys with it, and renames it to `.env` only once the release serves. A failed deploy deletes it. |
| `.env.previous` | The environment the previous release ran on. Written on every successful deploy, from the `.env` being replaced, together with `previous.json`. |

A failed deploy therefore restores the old images on the old environment, and re-renders the Redis ACL from it. `--rollback` restores the previous images on `.env.previous` and then makes it the live `.env`. The `ENV_FILE` secret stays whatever you last stored in GitHub: after a rollback, fix the secret before the next deploy or the next deploy reapplies the environment you rolled back from.

### Deployment Step Sequence

The deploy script executes the following stages in strict order:
1. Takes the deploy lock (`flock` on `/run/idraft-deploy.lock`; it fails if `flock` is missing), picks the candidate env (`.env.next` when present, else `.env`) and validates it and the three image references. The candidate must also render the Compose file.
2. Pulls all three container images by digest from GHCR. A failure here changes nothing.
3. Renders the Redis ACL from the candidate env (SHA-256 hashes only) into `/etc/idraft/redis/users.acl`, owned by uid 999 (the Redis image user) with mode 0600, and runs `ACL LOAD` on a running Redis. A missing Redis password fails the deploy. If `ACL LOAD` is refused (a password rotation), Redis is recreated to read the file.
4. Runs the database migrator to completion. A failure stops the deploy before any application container is touched, drops `.env.next` and re-renders the ACL from the serving release's `.env`.
5. Starts application services in order: `api`, `worker`, `web`, `caddy`, waiting for each to be running and healthy. A container that exits or restarts counts as failed at once.
6. Checks the stack through Caddy with `curl --resolve`: `/api/v1/me` must answer 401 and `/api/readyz` 200.
7. Only now rotates the records: the old `current.json` becomes `previous.json`, the `.env` being replaced becomes `.env.previous`, `.env.next` becomes `.env`, the new release becomes `current.json`, and a line is appended to `/srv/idraft/releases/history.log`.
8. On a failure after step 4, `.env.next` is deleted, the release recorded in `current.json` is restored on the unchanged `.env` (the ACL is re-rendered from it first) and the failure is logged as `DEPLOY_FAILED`. On the very first deploy there is nothing to restore: the application containers are stopped (postgres and redis stay up) and the script exits non-zero with a message.

## Rollback

Rollback is a single command that redeploys the previous release without touching the database schema.

### Manual Rollback Command

```bash
sudo /srv/idraft/infra/deploy.sh --rollback /etc/idraft/.env
```

The env file argument is required; there is no default. Rollback needs both `previous.json` and `.env.previous`; without them it says there is nothing to roll back and changes nothing. You can also trigger rollback via GitHub Actions by running `deploy.yml` with `workflow_dispatch` and setting `rollback: true`.

### Forward-Only Migrations Rule

Database migrations are strictly forward-only. Rollback redeploys the previous container images against the current database schema. Therefore, all migrations must follow the expand then contract pattern:

* **Expand:** Add new columns as nullable or with defaults; create new tables; add indexes concurrently.
* **Deploy:** Application code is deployed that supports both structures.
* **Contract:** In a subsequent release, drop deprecated columns or apply not-null constraints after older code is no longer running.

Never rename columns, drop active columns, or introduce restrictive NOT NULL constraints in a single release.

## Running Compose by Hand

Compose needs the three image references to render the file. Load them from the current release before any manual `docker compose` command:

```bash
cd /srv/idraft/infra/compose
sudo sh -c '
  rel=/srv/idraft/releases/current.json
  export API_IMAGE="$(jq -r .api $rel)" WORKER_IMAGE="$(jq -r .worker $rel)" WEB_IMAGE="$(jq -r .web $rel)"
  exec docker compose --env-file /etc/idraft/.env ps
'
```

## Creating the First Platform Operator

New installations run with `REGISTRATION=invited` by default. The initial administrative operator account must be created from the command line on the host.

Run the following command on the server. The shell that runs `docker compose` reads `/etc/idraft/.env` itself, and the migrator URL reaches the container through the environment (`-e DATABASE_URL` with no value), so the password is never an argument visible in `ps`:

```bash
cd /srv/idraft/infra/compose
sudo sh -c '
  set -a; . /etc/idraft/.env; set +a
  rel=/srv/idraft/releases/current.json
  export API_IMAGE="$(jq -r .api $rel)" WORKER_IMAGE="$(jq -r .worker $rel)" WEB_IMAGE="$(jq -r .web $rel)"
  export DATABASE_URL="$DATABASE_URL_MIGRATOR"
  exec docker compose --env-file /etc/idraft/.env run --rm \
    -e DATABASE_URL \
    api python -m idraft.cli create-operator --email operator@idraft.ai --name "Platform Admin"
'
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
| `DEPLOY_HOST` | GitHub Actions | Public IP or DNS hostname of the production host. |
| `DEPLOY_USER` | GitHub Actions | Deploy username (`deploy`). |
| `DEPLOY_SSH_KEY` | GitHub Actions | Private Ed25519 SSH key authorized on the production host. |
| `DEPLOY_KNOWN_HOSTS` | GitHub Actions | Pinned SSH host key line(s) of the production host. |
| `GHCR_PULL_USER` | GitHub Actions | GitHub user that owns the pull token. |
| `GHCR_PULL_TOKEN` | GitHub Actions | Read-only (`read:packages`) token with an expiry; sent to the host on stdin. |
| `ENV_FILE` | `/etc/idraft/.env` | Complete multi-line environment configuration containing all stack secrets. |
| `PG_SUPERUSER_PASSWORD` | PostgreSQL | Initial password for the `postgres` administrative role. |
| `PG_API_PASSWORD` | PostgreSQL / API | Password for `app_api` role. Subject to row-level security. |
| `PG_WORKER_PASSWORD` | PostgreSQL / Worker | Password for `app_worker` role. Cross-tenant worker access. |
| `PG_MIGRATOR_PASSWORD` | PostgreSQL / Migrator | Password for `migrator` role. Schema owner for the migrations. |
| `DATABASE_URL_API` | `/etc/idraft/.env` | `postgresql://app_api:<pass>@postgres:5432/idraft` |
| `DATABASE_URL_WORKER` | `/etc/idraft/.env` | `postgresql://app_worker:<pass>@postgres:5432/idraft` |
| `DATABASE_URL_MIGRATOR` | `/etc/idraft/.env` | `postgresql://migrator:<pass>@postgres:5432/idraft` |
| `REDIS_PASSWORD_APP` | Redis / API / Worker | Password for `app` user in Redis ACL. Required; the deploy fails without it. |
| `REDIS_PASSWORD_HEALTHCHECK` | Redis / Healthcheck | Password for `healthcheck` user (ping only) in Redis ACL. Required. |
| `REDIS_PASSWORD_ADMIN` | Redis / Admin | Password for `admin` user in Redis ACL. Required; `deploy.sh` uses it for `ACL LOAD`. |
| `REDIS_URL_APP` | `/etc/idraft/.env` | `redis://app:<pass>@redis:6379/0` |
| `REDIS_ACL_DIR` | `/etc/idraft/.env` | Host directory for the rendered `users.acl` (`/etc/idraft/redis`). |
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

Not secrets, but set in the same file: `HTTP_PORT`, `HTTPS_PORT`, `EDGE_SUBNET`, `BACKEND_SUBNET`, and the pinned `CADDY_IMAGE`, `POSTGRES_IMAGE`, `REDIS_IMAGE` (see `compose/.env.example`).

## Local Tests

Both need Docker and the `idraft-api:local`, `idraft-worker:local` and `idraft-web:local` images, and use throwaway secrets, their own Compose project names and non-default ports:

```bash
bash infra/test/deploy-dryrun.sh      # failed first deploy, v1, v2, bad pull, failing health gate, failing migration, bad env change, rollback with its env
bash infra/test/parallel-stack.sh     # two full stacks side by side on different ports and subnets
```

`bash infra/test/install-infra.sh` runs the real `idraft-install-infra` as root in an Ubuntu 24.04 container and checks the installed tree: scripts such as `compose/postgres/initdb/10-roles.sh` keep their exec bit even when the stage lost it, everything else is 0644, all root-owned. It also stages links to a root-only directory, inside the stage and as the stage itself, and checks that none of its content reaches `/srv/idraft`. The dry run also replaces the Caddyfile in place and checks that the running Caddy serves the change.

`bash infra/test/resolve-release.sh` needs only bash, jq and awk: it tests the release resolution logic against fixtures, without Docker or network.

The dry run asserts that a failed deploy leaves the serving release, the live env file, `current.json`, `previous.json` and the repository unchanged. It runs under the bash 3.2 of macOS, where `flock` is missing, so a no-op `flock` shim stands in there; the lock itself only runs on Linux.

## Routine Maintenance

### Checking Stack Status

Use the snippet in "Running Compose by Hand", ending in `docker compose --env-file /etc/idraft/.env ps`.

### Inspecting Container Logs

Same snippet, ending in one of:

```bash
exec docker compose --env-file /etc/idraft/.env logs -f --tail=100 api
exec docker compose --env-file /etc/idraft/.env logs -f --tail=100 worker
exec docker compose --env-file /etc/idraft/.env logs -f --tail=100 caddy
```

### Pruning Unused Images

After multiple deployments, old unreferenced images can be pruned:

```bash
sudo docker image prune -a --filter "until=168h" -f
```

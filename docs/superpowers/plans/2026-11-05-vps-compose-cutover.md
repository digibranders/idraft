# VPS Compose Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the live `app.idraft.ai` server from its hand-built systemd install to the Docker Compose stack in `infra/`, so every merge to `main` deploys through GitHub Actions.

**Architecture:** The repo already has the target: tested images pushed to GHCR by `backend.yml` and `web.yml`, `deploy.yml` shipping them over SSH, and `infra/deploy.sh` running migrations, health gates and rollback on the host. This plan fixes the drift between that stack and what the live API needs, prepares the host without downtime, rehearses the database restore beside the live install, then switches over in one short window with a tested way back.

**Tech Stack:** Docker Engine and Compose, Caddy 2, PostgreSQL 18, Redis 8, GitHub Actions, GHCR, bash.

---

## Facts this plan rests on (checked 2026-11-05)

- Host `root@187.126.121.25`, Ubuntu 24.04, 4 vCPU, 15 GB RAM, 184 GB free. No Docker. Only idraft runs on it now (firstfold was removed on 2026-10-28), so the "Shared host" section of `infra/README.md` and ADR-023 no longer describe this host.
- Live services: `idraft-api` (127.0.0.1:8000), `idraft-web` (127.0.0.1:3010), `idraft-worker`, nginx on 80 and 443 with a certbot certificate, PostgreSQL 18.6 on 127.0.0.1:5433 (database `idraft`, 211 MB, C.UTF-8, checksums on, migration 0016), Redis 7 on 127.0.0.1:6379 (27 short-lived keys, nothing that must survive). PostgreSQL 16 on 5432 holds no idraft data.
- `main` is at migration 0017 (`0017_one_google_connection.py`), so the first Compose deploy applies 0017.
- Env files in `/etc/idraft`: `api.env`, `worker.env`, `migrator.env`, `db.env`, `redis.env`. The Compose stack reads one file, `/etc/idraft/.env` (format in `infra/README.md`, "Rules for `/etc/idraft/.env`").
- Drift: the live API runs with `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `R2_RAW_ENDPOINT`, `R2_RAW_BUCKET`, `R2_RAW_ACCESS_KEY_ID`, `R2_RAW_SECRET_ACCESS_KEY`, `INSTALLATION_ID` and `HEALTH_TOKEN`. The `api` service in `infra/compose/docker-compose.yml` passes none of them, and no service passes `LOG_LEVEL`.
- The Caddyfile answers 404 for all of `/api/internal/*`, which hides `GET /api/internal/health` (token protected, `backend/src/idraft/api/health.py`).
- `infra/compose/postgres/initdb/10-roles.sh` creates the roles `migrator`, `app_api`, `app_worker`, `backup` and the extension `pg_stat_statements` when the volume is first initialised. The dump therefore excludes that extension.
- The `deploy` user (uid 1000) is left over from firstfold: `/etc/sudoers.d/firstfold-deploy` lets it run `/usr/local/sbin/firstfold-ci-sandbox` and other firstfold scripts as root, and its `authorized_keys` holds three keys (the owner's Mac Studio, `siddiqueahmed@Siddiques-Mac-mini.local`, an expired Hostinger key). Root has the same three keys. `bootstrap.sh` replaces the deploy user's `authorized_keys` with the CI key only.
- ufw still allows 7881/tcp, 7882/udp and 3478/udp (old LiveKit) and a list of Cloudflare ranges on 80 and 443. `bootstrap.sh` adds rules but removes none.

## Decisions for the owner (answer before Task 6)

| # | Question | Recommendation |
|---|---|---|
| D1 | Serve `GET /api/internal/health` publicly (it still needs the bearer token), or keep all of `/api/internal/*` closed and watch from the host? | Serve that one path. It was built to be watched from outside, and the API refuses a missing or wrong token. |
| D2 | Should the `production` environment require a reviewer to approve every deploy? | Restrict it to the `main` branch, no required reviewer, and protect `main` (Task 12). One person ships, and `main` only moves by reviewed PR. |
| D3 | GHCR images: make the three `idraft-*` packages public, or keep them private with an expiring read token? | Public. The source is public already; this removes a token that expires every 90 days. Needs Task 3. |
| D4 | Keep `siddiqueahmed@Siddiques-Mac-mini.local` on root and on `deploy`? | Owner's call. The deploy user loses it either way (bootstrap installs the CI key only). |
| D5 | `bootstrap.sh` turns on unattended reboots at 04:30 UTC when a kernel update needs one. Accept? | Accept. Docker restarts the stack on boot (`restart: unless-stopped`). |

## File structure

| File | Change |
|---|---|
| `infra/compose/docker-compose.yml` | Pass the drifted variables to `api`; `LOG_LEVEL` to `api` and `worker`. |
| `infra/compose/.env.example` | Add `HEALTH_TOKEN` and `LOG_LEVEL`; `R2_RAW_BUCKET` example becomes `idraft-raw`. |
| `infra/compose/caddy/Caddyfile` | (D1) let `/api/internal/health` through. |
| `infra/test/compose-env.sh` (new) | Renders the Compose file and asserts which variables each service receives. |
| `infra/test/deploy-dryrun.sh` | (D1) assert `/api/internal/health` is not a Caddy 404. |
| `.github/workflows/infra.yml` | Run `infra/test/compose-env.sh`. |
| `.github/workflows/deploy.yml` | (D3) skip the host GHCR login when no pull token is set. |
| `infra/README.md` | Mark "Shared host" as not current; document D1 and D3. |

Host-only work (Tasks 6 to 11) changes no repo file.

---

### Task 1: The api and worker receive every variable the live install uses

**Files:**
- Create: `infra/test/compose-env.sh`
- Modify: `infra/compose/docker-compose.yml` (the `api` and `worker` `environment` maps)
- Modify: `infra/compose/.env.example`
- Modify: `.github/workflows/infra.yml` (lint job)

- [ ] **Step 1: Write the failing test**

`infra/test/compose-env.sh`:

```bash
#!/usr/bin/env bash
# The Compose file must hand each service the variables the backend reads in production. Renders the file
# against the example env and checks the environment of api and worker. Needs docker compose, no daemon.
set -euo pipefail
cd "$(dirname "$0")/../compose"

rendered="$(docker compose -f docker-compose.yml --env-file .env.example config --format json)"

expect() {
  local service="$1"; shift
  local name
  for name in "$@"; do
    jq -e --arg s "$service" --arg n "$name" '.services[$s].environment | has($n)' <<<"$rendered" >/dev/null \
      || { echo "FAIL: $service does not receive $name" >&2; exit 1; }
  done
}

expect api DATAFORSEO_LOGIN DATAFORSEO_PASSWORD R2_RAW_ENDPOINT R2_RAW_BUCKET R2_RAW_ACCESS_KEY_ID \
  R2_RAW_SECRET_ACCESS_KEY INSTALLATION_ID HEALTH_TOKEN LOG_LEVEL
expect worker LOG_LEVEL INSTALLATION_ID DATAFORSEO_LOGIN R2_RAW_ENDPOINT

echo "Compose hands api and worker every variable they need."
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bash infra/test/compose-env.sh`
Expected: `FAIL: api does not receive DATAFORSEO_LOGIN`, exit 1.

- [ ] **Step 3: Pass the variables**

In `infra/compose/docker-compose.yml`, `api.environment`, after `BREACHED_PASSWORD_CHECK`:

```yaml
      LOG_LEVEL: ${LOG_LEVEL:-info}
      # The API reads the provider account (balance in the health report, Check now) and the raw bucket.
      # In production it refuses a DataForSEO login without INSTALLATION_ID (config/settings.py).
      DATAFORSEO_LOGIN: ${DATAFORSEO_LOGIN:-}
      DATAFORSEO_PASSWORD: ${DATAFORSEO_PASSWORD:-}
      R2_RAW_ENDPOINT: ${R2_RAW_ENDPOINT:-}
      R2_RAW_BUCKET: ${R2_RAW_BUCKET:-idraft-raw}
      R2_RAW_ACCESS_KEY_ID: ${R2_RAW_ACCESS_KEY_ID:-}
      R2_RAW_SECRET_ACCESS_KEY: ${R2_RAW_SECRET_ACCESS_KEY:-}
      INSTALLATION_ID: ${INSTALLATION_ID:-prod}
      HEALTH_TOKEN: ${HEALTH_TOKEN:-}
```

In `worker.environment`, after `PROCESS_ROLE`: `LOG_LEVEL: ${LOG_LEVEL:-info}`. Change the worker's `R2_RAW_BUCKET` default from `seo-raw` to `idraft-raw` (the bucket that exists).

Empty values are safe: `config/settings.py` treats an empty `HEALTH_TOKEN` (`_health_token_is_long_enough` returns `None` for `""`), an empty DataForSEO or R2 credential (`_empty_credential_is_none`) and an empty R2 endpoint (`_empty_is_unset`) as unset. No backend change.

In `infra/compose/.env.example`, under "Application Security and Auth":

```
# Bearer token for GET /api/internal/health, at least 24 characters (openssl rand -hex 24). Empty turns the route off.
HEALTH_TOKEN=
# Log level of api and worker: debug, info, warning, error or critical
LOG_LEVEL=info
```

and set `R2_RAW_BUCKET=idraft-raw`.

In `.github/workflows/infra.yml`, after the "Compose file renders" step:

```yaml
      - name: Compose hands each service its variables
        run: bash infra/test/compose-env.sh
```

and add `infra/test/compose-env.sh` to nothing else: the shellcheck step already globs `infra/test/*.sh`.

- [ ] **Step 4: Verify**

Run: `bash infra/test/compose-env.sh` → `Compose hands api and worker every variable they need.`
Run: `shellcheck -x infra/test/compose-env.sh && actionlint` → no output.

- [ ] **Step 5: Commit**

```bash
git add infra/test/compose-env.sh infra/compose/docker-compose.yml infra/compose/.env.example .github/workflows/infra.yml
git commit -m "Compose: hand the api the provider, bucket, installation and health settings it runs with"
```

### Task 2: (D1) Caddy serves the health report and nothing else under /api/internal

**Files:**
- Modify: `infra/compose/caddy/Caddyfile` (the `@internal` matcher)
- Modify: `infra/test/deploy-dryrun.sh` (`assert_serving`)
- Modify: `infra/README.md` ("Public readiness endpoint")

- [ ] **Step 1: Write the failing assertion**

In `assert_serving` in `infra/test/deploy-dryrun.sh`, after the `/api/internal/x` line:

```bash
  # The health report is token protected by the API, so Caddy passes it on. The dry-run env sets no
  # HEALTH_TOKEN, so the API answers 404 as problem JSON; Caddy's own 404 has no body and no content type.
  assert_eq "$(edge_content_type "$https_port" /api/internal/health)" "application/problem+json" \
    "$1: /api/internal/health is answered by the api"
```

Add to `infra/test/lib.sh`, next to `edge_status`:

```bash
# edge_content_type <port> <path>: the Content-Type of the answer through Caddy, empty when there is none.
edge_content_type() {
  curl -ksS -o /dev/null -w '%{content_type}' --max-time 5 \
    --resolve "localhost:$1:127.0.0.1" "https://localhost:$1$2" 2>/dev/null || true
}
```

If the API's problem responses carry a charset (`application/problem+json; charset=utf-8`), compare the part before `;` instead: `"${ct%%;*}"`.

- [ ] **Step 2: Run the dry run to verify it fails**

Run: `bash infra/test/deploy-dryrun.sh` (needs Docker and the `:local` images, see `infra/README.md`, "Local Tests").
Expected: FAIL at "/api/internal/health reaches the api".

- [ ] **Step 3: Change the matcher**

```caddyfile
	# Internal endpoints are never served publicly, except the health report: the API answers it only
	# with the bearer token (HEALTH_TOKEN) and 404 when no token is configured.
	@internal {
		path /api/internal/*
		not path /api/internal/health
	}
```

Update the comment above it and the "Public readiness endpoint" section of `infra/README.md` to say the same.

- [ ] **Step 4: Verify**

Run: `bash infra/test/deploy-dryrun.sh` → all steps pass.
Run the Caddyfile validation from `infra.yml` locally:
`docker run --rm -e DOMAIN=app.idraft.ai -v "$PWD/infra/compose/caddy:/etc/caddy:ro" "$(grep '^CADDY_IMAGE=' infra/compose/.env.example | cut -d= -f2-)" caddy validate --config /etc/caddy/Caddyfile` → `Valid configuration`.

- [ ] **Step 5: Commit**

```bash
git add infra/compose/caddy/Caddyfile infra/test/deploy-dryrun.sh infra/test/lib.sh infra/README.md
git commit -m "Caddy: pass the token-protected health report through, keep the rest of /api/internal closed"
```

### Task 3: (D3) Deploy pulls public images without a registry login

**Files:**
- Modify: `.github/workflows/deploy.yml` (step "Log the host in to GHCR")
- Modify: `infra/README.md` ("Registry login", secrets tables)

- [ ] **Step 1: Make the login conditional**

Replace the step's `run` with:

```yaml
        # Public packages need no login. A private registry sets both secrets; one without the other is a mistake.
        run: |
          if [ -z "$GHCR_PULL_USER" ] && [ -z "$GHCR_PULL_TOKEN" ]; then
            echo "No GHCR pull credentials: the images are pulled anonymously (public packages)."
            exit 0
          fi
          [ -n "$GHCR_PULL_USER" ] && [ -n "$GHCR_PULL_TOKEN" ] || { echo "Set both GHCR_PULL_USER and GHCR_PULL_TOKEN, or neither." >&2; exit 1; }
          printf '%s\n%s\n' "$GHCR_PULL_USER" "$GHCR_PULL_TOKEN" | ssh idraft-prod 'sudo /usr/local/sbin/idraft-ghcr-login'
```

- [ ] **Step 2: Verify**

Run: `actionlint .github/workflows/deploy.yml` → no output. Proven end to end by Task 11.

- [ ] **Step 3: Document and commit**

In `infra/README.md`, "Registry login": the packages are public (owner decision D3, 2026-11-05) and the two secrets are optional; mark them optional in both secrets tables.

```bash
git add .github/workflows/deploy.yml infra/README.md
git commit -m "Deploy: pull the public images anonymously when no GHCR token is set"
```

### Task 4: README says what the host is now

**Files:**
- Modify: `infra/README.md` (opening paragraph, "Shared host")

- [ ] **Step 1: Edit**

Opening paragraph: the VPS runs idraft only. At the top of "Shared host" add: "Not current. The second project was removed on 2026-10-28, so this host runs idraft alone, Caddy owns 80 and 443, and the sizing below is for the whole 15 GB host. Kept for when a second project returns."

- [ ] **Step 2: Gates, review, PR**

Run every `infra.yml` step locally (shellcheck, `bash infra/test/resolve-release.sh`, `docker compose ... config -q`, `bash infra/test/compose-env.sh`, Caddy validate, actionlint) and `bash infra/test/deploy-dryrun.sh`. Independent review of the branch (Sonnet). Open a PR to `develop`, then the release PR to `main` on the owner's word. The images used in Task 10 come from the `main` CI run of that release.

```bash
git add infra/README.md
git commit -m "Infra README: the host runs idraft alone since 2026-10-28"
```

### Task 5: GitHub side (owner runs the secret commands)

- [ ] **Step 1: Environment.** Create `production` with deployment branches limited to `main` (D2 decides the reviewer):

```bash
gh api -X PUT repos/digibranders/idraft/environments/production \
  -F 'deployment_branch_policy[protected_branches]=false' -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api -X POST repos/digibranders/idraft/environments/production/deployment-branch-policies -f name=main -f type=branch
```

- [ ] **Step 2: Deploy key.** On the owner's Mac, outside the repo: `ssh-keygen -t ed25519 -N '' -C idraft-deploy -f ~/.ssh/idraft-deploy`. The public half goes to the host in Task 7.

- [ ] **Step 3: Host key.** `ssh-keyscan -t ed25519 187.126.121.25` and compare its fingerprint with `ssh root@187.126.121.25 ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`.

- [ ] **Step 4: Secrets (owner).**

```bash
gh secret set DEPLOY_HOST --env production --body 187.126.121.25
gh secret set DEPLOY_SSH_KEY --env production < ~/.ssh/idraft-deploy
ssh-keyscan -t ed25519 187.126.121.25 2>/dev/null | gh secret set DEPLOY_KNOWN_HOSTS --env production
```

`ENV_FILE` is set in Task 11, from the host, once the env exists.

- [ ] **Step 5: (D3) Packages public.** For `idraft-api`, `idraft-worker`, `idraft-web` under the digibranders organisation: Package settings, Change visibility, Public. Check from any machine: `docker pull ghcr.io/digibranders/idraft-api@<digest>` without a login.

### Task 6: Safety copies before touching the host

- [ ] **Step 1:** Owner takes a Hostinger snapshot in hPanel and notes its time.
- [ ] **Step 2:** Off-host database copy:

```bash
ssh root@187.126.121.25 'sudo -u postgres pg_dump -p 5433 -Fc -d idraft' > ~/idraft-backups/idraft-pre-cutover-$(date -u +%Y%m%dT%H%MZ).dump
ssh root@187.126.121.25 'tar -C /etc -czf - idraft' > ~/idraft-backups/etc-idraft-pre-cutover.tgz
chmod 600 ~/idraft-backups/*
```

Expected: a dump of about 30 to 80 MB, and `pg_restore -l` on it lists tables in `auth`, `core`, `fp`, `ops`, `seo`.

### Task 7: Clean the host and install Docker (no downtime)

- [ ] **Step 1: Remove firstfold leftovers.**

```bash
ssh root@187.126.121.25 'set -e
rm -f /etc/sudoers.d/firstfold-deploy && visudo -c
rm -f /usr/local/sbin/firstfold-*
rm -f /home/deploy/.ssh/github-firstfold-* /home/deploy/.ssh/config /home/deploy/.ssh/known_hosts
for r in "7881/tcp" "7882/udp" "3478/udp"; do ufw delete allow "$r" || true; done
ufw status numbered | grep -c cloudflare-web'
```

Then delete the Cloudflare-range rules by number, highest number first (`ufw --force delete N`), until `ufw status | grep -c cloudflare` prints 0. Leave `22/tcp`, `80/tcp`, `443/tcp`. `/var/backups/firstfold` and `/root/backup-old-projects-*` stay until the owner says otherwise.

- [ ] **Step 2: Bootstrap.** From the worktree on the release commit:

```bash
scp -r infra ~/.ssh/idraft-deploy.pub root@187.126.121.25:/root/
ssh root@187.126.121.25 'bash /root/infra/bootstrap.sh --deploy-key /root/idraft-deploy.pub'
```

No `--harden-ssh`: `sshd -T` already shows key-only login. Expected: Docker installed, `/srv/idraft/{releases,infra,shared,incoming}` created, `/etc/idraft` "Left alone", the five sudo commands in `/etc/sudoers.d/idraft-deploy`.

- [ ] **Step 3: Install infra the way the pipeline does.** From the worktree on the release commit, as the deploy user:

```bash
rsync -rt --delete --no-links -e "ssh -i ~/.ssh/idraft-deploy" infra/ deploy@187.126.121.25:/srv/idraft/incoming/infra/
ssh -i ~/.ssh/idraft-deploy deploy@187.126.121.25 'sudo /usr/local/sbin/idraft-install-infra'
```

Expected: `/srv/idraft/infra/deploy.sh` and `/srv/idraft/infra/compose/` exist, root-owned.

- [ ] **Step 4: Check.** `ssh -i ~/.ssh/idraft-deploy deploy@187.126.121.25 sudo -l` lists only the idraft commands. `docker version` on the host works. `curl -sI https://app.idraft.ai/login` is still 200 (nginx untouched). `ufw status` shows only 22, 80, 443 (tcp, and 443/udp from bootstrap).

### Task 8: Build /etc/idraft/.env on the host

Secrets stay on the host. The database and Redis are new, so their passwords are new; the application keys are copied verbatim.

- [ ] **Step 1: Write the file**

```bash
ssh root@187.126.121.25 'bash -s' <<'EOF'
set -euo pipefail
umask 077
get() { sed -n "s/^$2=//p" "/etc/idraft/$1.env" | head -n 1; }
gen() { openssl rand -hex 24; }
pg_api="$(gen)" pg_worker="$(gen)" pg_migrator="$(gen)" r_app="$(gen)"
ex=/srv/idraft/infra/compose/.env.example
{
  grep -E '^(CADDY_IMAGE|POSTGRES_IMAGE|REDIS_IMAGE|HTTP_PORT|HTTPS_PORT|EDGE_SUBNET|BACKEND_SUBNET)=' "$ex"
  echo "DOMAIN=app.idraft.ai"
  echo "ACME_EMAIL=admin@idraft.ai"
  echo "APP_ENV=production"
  echo "APP_ORIGIN=$(get api APP_ORIGIN)"
  echo "POSTGRES_DB=idraft"
  echo "POSTGRES_USER=postgres"
  echo "PG_SUPERUSER_PASSWORD=$(gen)"
  echo "PG_API_PASSWORD=$pg_api"
  echo "PG_WORKER_PASSWORD=$pg_worker"
  echo "PG_MIGRATOR_PASSWORD=$pg_migrator"
  echo "DATABASE_URL_API=postgresql://app_api:$pg_api@postgres:5432/idraft"
  echo "DATABASE_URL_WORKER=postgresql://app_worker:$pg_worker@postgres:5432/idraft"
  echo "DATABASE_URL_MIGRATOR=postgresql://migrator:$pg_migrator@postgres:5432/idraft"
  echo "REDIS_PASSWORD_APP=$r_app"
  echo "REDIS_PASSWORD_HEALTHCHECK=$(gen)"
  echo "REDIS_PASSWORD_ADMIN=$(gen)"
  echo "REDIS_URL_APP=redis://app:$r_app@redis:6379/0"
  echo "REDIS_ACL_DIR=/etc/idraft/redis"
  for k in TOTP_ENCRYPTION_KEY SECRETS_ENCRYPTION_KEY GOOGLE_OAUTH_CLIENT_ID GOOGLE_OAUTH_CLIENT_SECRET \
           EMAIL_PROVIDER EMAIL_API_KEY EMAIL_FROM HEALTH_TOKEN; do echo "$k=$(get api "$k")"; done
  for k in DATAFORSEO_LOGIN DATAFORSEO_PASSWORD R2_RAW_ENDPOINT R2_RAW_BUCKET R2_RAW_ACCESS_KEY_ID \
           R2_RAW_SECRET_ACCESS_KEY INSTALLATION_ID; do echo "$k=$(get worker "$k")"; done
  echo "LOG_LEVEL=$(get worker LOG_LEVEL)"
  echo "REGISTRATION=invited"
  echo "BREACHED_PASSWORD_CHECK=true"
} > /etc/idraft/.env.new
chmod 600 /etc/idraft/.env.new
/usr/local/sbin/idraft-check-env < /etc/idraft/.env.new && echo "env accepted"
EOF
```

If the checker refuses `EMAIL_FROM` (the live value is a display name and an address, with spaces and `<>`), set `EMAIL_FROM=hello@idraft.ai` and tell the owner the sender name drops until the checker allows it.

- [ ] **Step 2: Check without printing values.** `grep -o '^[A-Z0-9_]*=$' /etc/idraft/.env.new` prints the keys whose value is empty. Expected: none, or `LOG_LEVEL=` (then set `LOG_LEVEL=info`). Compare `TOTP_ENCRYPTION_KEY` and `SECRETS_ENCRYPTION_KEY` with `api.env` by hash: `sha256sum` of each extracted value must match. Losing either key makes stored 2FA secrets and Google tokens unreadable.
- [ ] **Step 3:** `mv /etc/idraft/.env.new /etc/idraft/.env` (root, 0600). The old `*.env` files stay as they are: the systemd install keeps running from them until Task 10.

### Task 9: Rehearse the restore beside the live install

A second Compose project on other ports and subnets, with a copy of today's data and no provider credentials, so nothing is spent and nothing touches production. It runs the real `deploy.sh` with the overrides `infra/test/parallel-stack.sh` uses.

- [ ] **Step 1: Prepare.** On the host, as root. `/srv/idraft/incoming/digests.json` holds the release from Task 4: `api` and `worker` from the `backend-digests` artifact, `web` from `web-digests`, `sha` the release commit (`gh run download <run id> -n backend-digests` on the Mac, then `scp`).

```bash
mkdir -p /root/rehearsal && chmod 700 /root/rehearsal
sed -e 's/^HTTP_PORT=.*/HTTP_PORT=18080/' -e 's/^HTTPS_PORT=.*/HTTPS_PORT=18443/' \
    -e 's#^EDGE_SUBNET=.*#EDGE_SUBNET=172.31.20.0/24#' -e 's#^BACKEND_SUBNET=.*#BACKEND_SUBNET=172.31.10.0/24#' \
    -e 's/^DATAFORSEO_LOGIN=.*/DATAFORSEO_LOGIN=/' -e 's/^DATAFORSEO_PASSWORD=.*/DATAFORSEO_PASSWORD=/' \
    -e 's/^INSTALLATION_ID=.*/INSTALLATION_ID=rehearsal/' \
    -e 's#^REDIS_ACL_DIR=.*#REDIS_ACL_DIR=/root/rehearsal/redis#' /etc/idraft/.env > /root/rehearsal/rehearsal.env
chmod 600 /root/rehearsal/rehearsal.env
export COMPOSE_PROJECT_NAME=idraft-rehearsal IDRAFT_RELEASES_DIR=/root/rehearsal/releases \
  IDRAFT_LOCK_FILE=/root/rehearsal/deploy.lock IDRAFT_REDIS_ACL_DIR=/root/rehearsal/redis
export API_IMAGE="$(jq -r .api /srv/idraft/incoming/digests.json)" WORKER_IMAGE="$(jq -r .worker /srv/idraft/incoming/digests.json)" WEB_IMAGE="$(jq -r .web /srv/idraft/incoming/digests.json)"
dc() { docker compose -f /srv/idraft/infra/compose/docker-compose.yml --env-file /root/rehearsal/rehearsal.env "$@"; }
dc up -d postgres
```

Wait until `dc ps postgres` shows `healthy`. Only Postgres starts here: Redis needs the ACL file, which `deploy.sh` renders in Step 4.

- [ ] **Step 2: Restore.**

```bash
sudo -u postgres pg_dump -p 5433 -Fc -d idraft --exclude-extension=pg_stat_statements > /root/rehearsal/idraft.dump
dc exec -T postgres pg_restore -U postgres -d idraft --exit-on-error --single-transaction < /root/rehearsal/idraft.dump
```

Expected: exit 0. If it fails, the message names the object; fix the dump flags here, not during the cutover.

- [ ] **Step 3: Compare.** Row counts per table on both sides must match:

```bash
count='select schemaname||'"'"'.'"'"'||relname||'"'"' '"'"'||n_live_tup from pg_stat_user_tables order by 1'
sudo -u postgres psql -p 5433 -d idraft -Atc "ANALYZE" >/dev/null; sudo -u postgres psql -p 5433 -d idraft -Atc "$count" > /root/rehearsal/host.counts
dc exec -T postgres psql -U postgres -d idraft -Atc "ANALYZE" >/dev/null; dc exec -T postgres psql -U postgres -d idraft -Atc "$count" > /root/rehearsal/compose.counts
diff /root/rehearsal/host.counts /root/rehearsal/compose.counts && echo "counts match"
```

`n_live_tup` is an estimate; for any line that differs, compare `select count(*)` on that table.

- [ ] **Step 4: Run the release on it.** In the same shell: `/srv/idraft/infra/deploy.sh /root/rehearsal/rehearsal.env /srv/idraft/incoming/digests.json`. Expected: Redis ACL rendered, migrator applies 0017, api, worker, web and caddy healthy, "/api/v1/me 401" and "/api/readyz 200" through the rehearsal Caddy. Then `curl -ksS -o /dev/null -w '%{http_code}\n' --resolve app.idraft.ai:18443:127.0.0.1 https://app.idraft.ai:18443/login` → 200. Caddy cannot get a certificate on port 18443 and serves its internal one; `-k` covers that. The live site on 443 must still answer 200 throughout.
- [ ] **Step 5: Remove it.** `dc down -v`, `rm -rf /root/rehearsal`, `unset COMPOSE_PROJECT_NAME IDRAFT_RELEASES_DIR IDRAFT_LOCK_FILE IDRAFT_REDIS_ACL_DIR`.

### Task 10: Cutover (maintenance window, about 15 minutes)

Pick a quiet time. The site is down from Step 2 to Step 6.

- [ ] **Step 1: Ready.** Digests file `/srv/idraft/incoming/digests.json` with `api`, `worker`, `web` and `sha` of the release. `docker pull` of the three digests succeeded (so the window does not wait on downloads).
- [ ] **Step 2: Stop writers.** `systemctl stop idraft-worker idraft-api idraft-web`. Check nothing holds a connection: `sudo -u postgres psql -p 5433 -Atc "select count(*) from pg_stat_activity where datname='idraft'"` → 0.
- [ ] **Step 3: Final dump.** `sudo -u postgres pg_dump -p 5433 -Fc -d idraft --exclude-extension=pg_stat_statements > /root/cutover-$(date -u +%Y%m%dT%H%MZ).dump` and the host row counts as in Task 9 Step 3.
- [ ] **Step 4: Free the ports.** `systemctl stop nginx`.
- [ ] **Step 5: Database.** In a fresh root shell (no rehearsal variables), with `API_IMAGE`, `WORKER_IMAGE`, `WEB_IMAGE` exported from the digests file: `docker compose -f /srv/idraft/infra/compose/docker-compose.yml --env-file /etc/idraft/.env up -d postgres`, wait for healthy, `pg_restore` the Step 3 dump as in Task 9 Step 2, and the counts diff as in Task 9 Step 3: they must match. Redis is left to `deploy.sh`.
- [ ] **Step 6: Deploy.** `/srv/idraft/infra/deploy.sh /etc/idraft/.env /srv/idraft/incoming/digests.json`. Expected: migrator applies 0017, api, worker, web and caddy healthy, "/api/v1/me 401" and "/api/readyz 200" through Caddy, release recorded in `/srv/idraft/releases/current.json`.
- [ ] **Step 7: Verify from outside.** From the Mac: `curl -sS -o /dev/null -w '%{http_code}\n' https://app.idraft.ai/api/healthz` → 200; `https://app.idraft.ai/login` → 200 with a Let's Encrypt certificate (`curl -vI` shows the issuer); `GET /api/internal/health` with the token → 200, `"release"` is the release sha, migrations `0017`, worker reporting. The owner signs in and opens a project.
- [ ] **Step 8: If any step from 5 on fails: go back.** `cd /srv/idraft/infra/compose && docker compose --env-file /etc/idraft/.env down` (volumes kept), `systemctl start nginx idraft-api idraft-worker idraft-web`, check `https://app.idraft.ai/api/healthz`. The host database was not written after Step 2, and 0017 ran only inside the container, so the old install comes back as it was.
- [ ] **Step 9: Retire the old install** (only after Step 7 passed):

```bash
systemctl disable --now idraft-api idraft-web idraft-worker nginx redis-server postgresql@18-main postgresql@16-main certbot.timer
```

Keep `/srv/idraft/backend`, `/srv/idraft/web`, `/srv/idraft/web.prev`, `/var/lib/postgresql/18`, `/etc/idraft/*.env` and the cutover dump for 7 days, then delete them on the owner's word.

### Task 11: First deploy through GitHub Actions

- [ ] **Step 1: ENV_FILE (owner).** The secret must equal the live env:

```bash
ssh root@187.126.121.25 'cat /etc/idraft/.env' | gh secret set ENV_FILE --env production
```

- [ ] **Step 2: Run the pipeline.** `gh workflow run deploy.yml -f api_image=<api digest> -f worker_image=<worker digest> -f web_image=<web digest>` (the same release, so nothing changes). Expected: the job passes; `/srv/idraft/releases/history.log` gets a second line.
- [ ] **Step 3: Rollback works.** `gh workflow run deploy.yml -f rollback=true`, then deploy the same digests again. Both pass and the site stays up.

### Task 12: Close out

- [ ] **Step 1: Branch protection on `main` and `develop`:** pull request required for `main`, required checks `checks` (backend), `checks` (web) and `lint` (infra) as they are named in the PR checks, no force pushes. Turn on "Allow auto-merge" for the repository.
- [ ] **Step 2:** After the 7 days of Task 10 Step 9 and on the owner's word, delete the old install (this also removes the stray `._*` files in `/srv/idraft/backend`).

## Not in this plan

- Nightly encrypted database backup to R2 (`docs/23-backup-disaster-recovery.md`). The cutover moves the data into the `pgdata` volume, so this is the next plan and should follow within days.
- Speeding up the web CI job (about 12 minutes).
- Uptime monitoring that calls `/api/internal/health`.

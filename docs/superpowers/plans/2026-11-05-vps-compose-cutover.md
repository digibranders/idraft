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
- ufw still allows 7881/tcp, 7882/udp and 3478/udp (old LiveKit) and a list of Cloudflare ranges on 80 and 443, besides `80/tcp` and `443/tcp` from anywhere. `bootstrap.sh` adds rules but removes none. `app.idraft.ai` is DNS only at Cloudflare (A record straight to the host, no AAAA), so the Cloudflare rules do nothing and Caddy sees real client addresses.
- `pg_dump` on the host is the Ubuntu wrapper, which runs version 16. Every dump in this plan calls `/usr/lib/postgresql/18/bin/pg_dump` (needed for a PG 18 server and for `--exclude-extension`).
- `EMAIL_FROM` in `api.env` is wrapped in quotes (systemd strips them; the Compose env checker refuses them) and holds a display name with spaces, which the checker allows. No other value is quoted. `worker.env` and `api.env` hold identical provider, bucket, installation and secrets-key values.
- Measured on the live database: the PG 18 `pg_dump` with `--exclude-extension=pg_stat_statements` works (custom format 6 MB), schema dumps carry two `\restrict` lines with a random key (filtered before any diff), and the exact-count script covers 114 tables.
- Leftover nginx site files `/etc/nginx/sites-available/firstfold*` (not enabled).
- Inside the Postgres container, `pg_hba.conf` allows the `postgres` user over the local socket by peer authentication only, so every `docker compose exec` into Postgres runs with `-u postgres`.

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

Run every `infra.yml` step locally (shellcheck, `bash infra/test/resolve-release.sh`, `docker compose ... config -q`, `bash infra/test/compose-env.sh`, Caddy validate, actionlint) and `bash infra/test/deploy-dryrun.sh`. Independent review of the branch (Sonnet). Open a PR to `develop`, then the release PR to `main` on the owner's word.

This release touches only `infra/` and `.github/`, so it builds no images. The images for Tasks 9 and 10 are the newest successful `backend` and `web` push runs on `main` (Task 5 Step 6).

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

- [ ] **Step 3: Host key, verified once.** Save the scan and compare it with the host's own fingerprint:

```bash
ssh-keyscan -t ed25519 187.126.121.25 2>/dev/null > ~/.ssh/idraft-known-hosts
ssh-keygen -lf ~/.ssh/idraft-known-hosts
ssh root@187.126.121.25 ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

The two SHA256 fingerprints must be equal. Step 4 uses this file, not a second scan.

- [ ] **Step 4: Pause automatic deploys.** Once the secrets exist, any backend or web push to `main` would run `deploy.yml` against a host that is not ready. `gh workflow disable deploy.yml` now; Task 11 enables it.

- [ ] **Step 5: Secrets (owner).**

```bash
gh secret set DEPLOY_HOST --env production --body 187.126.121.25
gh secret set DEPLOY_SSH_KEY --env production < ~/.ssh/idraft-deploy
gh secret set DEPLOY_KNOWN_HOSTS --env production < ~/.ssh/idraft-known-hosts
```

`ENV_FILE` is set in Task 11, from the host, once the env exists.

- [ ] **Step 6: Pick the release images.** The newest successful push runs of `backend` and `web` on `main`:

```bash
b=$(gh run list -w backend -b main -e push -s success -L 1 --json databaseId,headSha --jq '.[0]')
w=$(gh run list -w web -b main -e push -s success -L 1 --json databaseId,headSha --jq '.[0]')
mkdir -p ~/idraft-release && cd ~/idraft-release && rm -f ./*.json
gh run download "$(jq -r .databaseId <<<"$b")" -n backend-digests
gh run download "$(jq -r .databaseId <<<"$w")" -n web-digests
```

The release commit `sha` is the newer of the two `headSha` values, and the other must be its ancestor (`git merge-base --is-ancestor <older> <newer>`); otherwise wait for a commit where both are green. Then:

```bash
jq -n --slurpfile b backend-digests.json --slurpfile w web-digests.json --arg sha <newer headSha> \
  '{api: $b[0].api, worker: $b[0].worker, web: $w[0].web, sha: $sha}' > digests.json
```

- [ ] **Step 7: (D3) Packages public.** For `idraft-api`, `idraft-worker`, `idraft-web` under the digibranders organisation: Package settings, Change visibility, Public. Check from any machine: `docker pull ghcr.io/digibranders/idraft-api@<digest>` without a login.

### Task 6: Safety copies before touching the host

- [ ] **Step 1:** Owner takes a Hostinger snapshot in hPanel and notes its time.
- [ ] **Step 2:** Off-host database copy:

```bash
umask 077; mkdir -p -m 700 ~/idraft-backups
ssh root@187.126.121.25 'sudo -u postgres /usr/lib/postgresql/18/bin/pg_dump -p 5433 -Fc -d idraft' > ~/idraft-backups/idraft-pre-cutover-$(date -u +%Y%m%dT%H%MZ).dump
ssh root@187.126.121.25 'tar -C /etc -czf - idraft' > ~/idraft-backups/etc-idraft-pre-cutover.tgz
```

The tarball holds every production secret: it stays in that 0700 folder and is deleted once the cutover has held for 7 days.

Expected: a dump of about 30 to 80 MB, and `pg_restore -l` on it lists tables in `auth`, `core`, `fp`, `ops`, `seo`.

### Task 7: Clean the host and install Docker (no downtime)

- [ ] **Step 1: Bootstrap.** From the worktree on the release commit:

```bash
scp -r infra ~/.ssh/idraft-deploy.pub root@187.126.121.25:/root/
ssh root@187.126.121.25 'bash /root/infra/bootstrap.sh --deploy-key /root/idraft-deploy.pub && systemctl reload fail2ban'
```

No `--harden-ssh`: `sshd -T` already shows key-only login. `systemctl reload fail2ban` applies the new jail (bootstrap's `enable --now` does not reload a running fail2ban). Expected: Docker installed, `/srv/idraft/{releases,infra,shared,incoming}` created, `/etc/idraft` "Left alone", the five sudo commands in `/etc/sudoers.d/idraft-deploy`, `ufw` allowing 80/tcp, 443/tcp and 443/udp.

- [ ] **Step 2: Remove firstfold leftovers.** After bootstrap, so 80 and 443 are allowed throughout:

```bash
ssh root@187.126.121.25 'set -e
rm -f /etc/sudoers.d/firstfold-deploy && visudo -c
rm -f /usr/local/sbin/firstfold-* /etc/nginx/sites-available/firstfold*
rm -f /home/deploy/.ssh/github-firstfold-* /home/deploy/.ssh/config /home/deploy/.ssh/known_hosts
for r in "7881/tcp" "7882/udp" "3478/udp"; do ufw delete allow "$r" || true; done
while n="$(ufw status numbered | sed -n "s/^\[ *\([0-9]*\)\].*cloudflare-web.*/\1/p" | tail -n 1)"; [ -n "$n" ]; do ufw --force delete "$n"; done
ufw status'
```

Expected `ufw status`: 22/tcp, 80/tcp, 443/tcp, 443/udp (v4 and v6) and nothing else. `/var/backups/firstfold` and `/root/backup-old-projects-*` stay until the owner says otherwise.

- [ ] **Step 3: Install infra the way the pipeline does.** From the worktree on the release commit, as the deploy user:

```bash
rsync -rt --delete --no-links -e "ssh -i ~/.ssh/idraft-deploy" infra/ deploy@187.126.121.25:/srv/idraft/incoming/infra/
ssh -i ~/.ssh/idraft-deploy deploy@187.126.121.25 'sudo /usr/local/sbin/idraft-install-infra'
```

Expected: `/srv/idraft/infra/deploy.sh` and `/srv/idraft/infra/compose/` exist, root-owned.

- [ ] **Step 4: Check.** `ssh -i ~/.ssh/idraft-deploy deploy@187.126.121.25 sudo -l` lists only the idraft commands. `docker version` on the host works. `curl -sI https://app.idraft.ai/login` is still 200 (nginx untouched).

### Task 8: Build /etc/idraft/.env on the host

Secrets stay on the host. The database and Redis are new, so their passwords are new; the application keys are copied verbatim.

- [ ] **Step 1: Write the file**

```bash
ssh root@187.126.121.25 'bash -s' <<'EOF'
set -euo pipefail
umask 077
# The last assignment wins, as in systemd, and one pair of surrounding quotes is dropped, as systemd does.
get() {
  local v
  v="$(sed -n "s/^$2=//p" "/etc/idraft/$1.env" | tail -n 1)"
  case "$v" in \"*\") v="${v#\"}"; v="${v%\"}" ;; \'*\') v="${v#\'}"; v="${v%\'}" ;; esac
  printf '%s' "$v"
}
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
  lvl="$(get worker LOG_LEVEL)"; echo "LOG_LEVEL=${lvl:-info}"
  echo "REGISTRATION=invited"
  echo "BREACHED_PASSWORD_CHECK=true"
} > /etc/idraft/.env.new
chmod 600 /etc/idraft/.env.new
/usr/local/sbin/idraft-check-env /etc/idraft/.env.new && echo "env accepted"
EOF
```

Expected: `env accepted`. The checker takes the file as its argument (`infra/host/idraft-check-env`).

- [ ] **Step 2: Check without printing values.**

```bash
ssh root@187.126.121.25 'bash -s' <<'EOF'
cd /etc/idraft
echo "empty keys:"; grep -o '^[A-Z0-9_]*=$' .env.new
echo "keys of the old files missing from the new one:"
comm -23 <(cat api.env worker.env | sed -n 's/^\([A-Z0-9_]*\)=.*/\1/p' | sort -u) \
         <(sed -n 's/^\([A-Z0-9_]*\)=.*/\1/p' .env.new | sort -u)
for k in TOTP_ENCRYPTION_KEY SECRETS_ENCRYPTION_KEY; do
  old="$(sed -n "s/^$k=//p" api.env | tail -n 1 | sed "s/^[\"']//; s/[\"']\$//" | sha256sum)"
  new="$(sed -n "s/^$k=//p" .env.new | sha256sum)"
  [ "$old" = "$new" ] && echo "$k carried over" || echo "$k DIFFERS: stop"
done
EOF
```

Expected: no empty keys; the missing list holds only `DATABASE_URL`, `REDIS_URL`, `PROCESS_ROLE` and `HEARTBEAT_FILE` (Compose sets those per service); both keys "carried over". Losing either key makes stored 2FA secrets and Google tokens unreadable.
- [ ] **Step 3:** `mv /etc/idraft/.env.new /etc/idraft/.env` (root, 0600). The old `*.env` files stay as they are: the systemd install keeps running from them until Task 10.

### Task 9: Rehearse the restore beside the live install

A second Compose project on other ports and subnets, with a copy of today's data, so the restore and the first deploy are proven before the window. It runs the real `deploy.sh` with the overrides `infra/test/parallel-stack.sh` uses. It holds production data, so it runs as a local install with no outside keys (no provider spend, no mail, no Google, no R2), its ports are closed to the internet, and it is removed the same hour.

- [ ] **Step 1: Check the host database has nothing the dump leaves out.** Roles and per-database settings are not in a `pg_dump` without `--create`; `10-roles.sh` makes the roles on the new side.

```bash
sudo -u postgres psql -p 5433 -Atc "select rolname from pg_roles where rolname !~ '^pg_' order by 1"
sudo -u postgres psql -p 5433 -Atc "select coalesce(d.datname,'*'), coalesce(r.rolname,'*'), s.setconfig from pg_db_role_setting s left join pg_database d on d.oid = s.setdatabase left join pg_roles r on r.oid = s.setrole"
```

Expected: the roles `app_api`, `app_worker`, `backup`, `migrator`, `postgres`; settings only the per-role ones `10-roles.sh` sets too (`migrator` lock and statement timeouts, `app_api` and `app_worker` statement timeouts). Anything else is copied to the new side by hand in Step 3 and in the cutover.

- [ ] **Step 2: Prepare.** On the host, as root. Copy `~/idraft-release/digests.json` (Task 5 Step 6) to `/srv/idraft/incoming/digests.json` with `scp`.

```bash
mkdir -p -m 700 /root/rehearsal
sed -e 's/^HTTP_PORT=.*/HTTP_PORT=18080/' -e 's/^HTTPS_PORT=.*/HTTPS_PORT=18443/' \
    -e 's#^EDGE_SUBNET=.*#EDGE_SUBNET=172.31.20.0/24#' -e 's#^BACKEND_SUBNET=.*#BACKEND_SUBNET=172.31.10.0/24#' \
    -e 's/^DOMAIN=.*/DOMAIN=localhost/' -e 's/^APP_ENV=.*/APP_ENV=local/' -e 's#^APP_ORIGIN=.*#APP_ORIGIN=https://localhost:18443#' \
    -e 's/^EMAIL_PROVIDER=.*/EMAIL_PROVIDER=console/' -e 's/^EMAIL_API_KEY=.*/EMAIL_API_KEY=/' \
    -e 's/^\(DATAFORSEO_LOGIN\|DATAFORSEO_PASSWORD\|GOOGLE_OAUTH_CLIENT_ID\|GOOGLE_OAUTH_CLIENT_SECRET\|R2_RAW_ENDPOINT\|R2_RAW_ACCESS_KEY_ID\|R2_RAW_SECRET_ACCESS_KEY\|HEALTH_TOKEN\)=.*/\1=/' \
    -e 's/^INSTALLATION_ID=.*/INSTALLATION_ID=rehearsal/' \
    -e 's#^REDIS_ACL_DIR=.*#REDIS_ACL_DIR=/root/rehearsal/redis#' /etc/idraft/.env > /root/rehearsal/rehearsal.env
chmod 600 /root/rehearsal/rehearsal.env
# Docker publishes on 0.0.0.0 and bypasses ufw: drop outside traffic to the rehearsal ports. Removed in Step 7.
pub="$(ip route get 1.1.1.1 | awk '{for (i=1;i<NF;i++) if ($i=="dev") print $(i+1)}')"
for p in 18080 18443; do
  iptables -I DOCKER-USER -i "$pub" -p tcp -m conntrack --ctorigdstport "$p" -j DROP
  iptables -I DOCKER-USER -i "$pub" -p udp -m conntrack --ctorigdstport "$p" -j DROP
done
export COMPOSE_PROJECT_NAME=idraft-rehearsal IDRAFT_RELEASES_DIR=/root/rehearsal/releases \
  IDRAFT_LOCK_FILE=/root/rehearsal/deploy.lock IDRAFT_REDIS_ACL_DIR=/root/rehearsal/redis
d=/srv/idraft/incoming/digests.json
export API_IMAGE="$(jq -r .api $d)" WORKER_IMAGE="$(jq -r .worker $d)" WEB_IMAGE="$(jq -r .web $d)"
dc() { docker compose -f /srv/idraft/infra/compose/docker-compose.yml --env-file /root/rehearsal/rehearsal.env "$@"; }
dc up -d postgres
```

Wait until `dc ps postgres` shows `healthy`. Only Postgres starts here: Redis needs the ACL file, which `deploy.sh` renders in Step 5. From the Mac, `curl -m 5 -k https://187.126.121.25:18443/` must time out once Caddy runs (Step 5).

- [ ] **Step 3: Restore.**

```bash
sudo -u postgres /usr/lib/postgresql/18/bin/pg_dump -p 5433 -Fc -d idraft --exclude-extension=pg_stat_statements > /root/rehearsal/idraft.dump
dc exec -T -u postgres postgres pg_restore -d idraft --exit-on-error --single-transaction < /root/rehearsal/idraft.dump
```

Expected: exit 0. If it fails, the message names the object; fix the dump flags here, not during the cutover.

- [ ] **Step 4: Compare data and schema.** Exact counts per table, and the schema with owners and grants:

```bash
# Kept outside /root/rehearsal: the cutover uses it again.
cat > /root/counts.sql <<'SQL'
select format('select %L || '' '' || count(*) from %I.%I', schemaname || '.' || relname, schemaname, relname)
from pg_stat_user_tables order by schemaname, relname
\gexec
SQL
chmod 644 /root/counts.sql
sudo -u postgres psql -p 5433 -d idraft -At < /root/counts.sql > /root/rehearsal/host.counts
dc exec -T -u postgres postgres psql -d idraft -At < /root/counts.sql > /root/rehearsal/compose.counts
diff /root/rehearsal/host.counts /root/rehearsal/compose.counts && echo "counts match"
sudo -u postgres /usr/lib/postgresql/18/bin/pg_dump -p 5433 -s -d idraft --exclude-extension=pg_stat_statements > /root/rehearsal/host.schema
dc exec -T -u postgres postgres pg_dump -s -d idraft --exclude-extension=pg_stat_statements > /root/rehearsal/compose.schema
strip() { grep -vE '^(-- Dumped|\\(un)?restrict )' "$1"; }   # version lines and the per-dump random \restrict key
diff <(strip /root/rehearsal/host.schema) <(strip /root/rehearsal/compose.schema) && echo "schema, owners and grants match"
```

Expected: both "match" lines. This runs before the migrator, so both sides are at 0016.

- [ ] **Step 5: Run the release on it.** In the same shell: `/srv/idraft/infra/deploy.sh /root/rehearsal/rehearsal.env /srv/idraft/incoming/digests.json`. Expected: Redis ACL rendered, migrator applies 0017, api, worker, web and caddy healthy, "/api/v1/me 401" and "/api/readyz 200" through the rehearsal Caddy (on `localhost`, Caddy issues from its internal CA). Then `curl -ksS -o /dev/null -w '%{http_code}\n' --resolve localhost:18443:127.0.0.1 https://localhost:18443/login` → 200. The live site on 443 must still answer 200 throughout.
- [ ] **Step 6: Note the timings.** How long Step 3 and the migrator in Step 5 took: the cutover window is about those plus five minutes.
- [ ] **Step 7: Remove it.**

```bash
dc down -v
for p in 18080 18443; do
  iptables -D DOCKER-USER -i "$pub" -p tcp -m conntrack --ctorigdstport "$p" -j DROP
  iptables -D DOCKER-USER -i "$pub" -p udp -m conntrack --ctorigdstport "$p" -j DROP
done
rm -rf /root/rehearsal
unset COMPOSE_PROJECT_NAME IDRAFT_RELEASES_DIR IDRAFT_LOCK_FILE IDRAFT_REDIS_ACL_DIR
docker ps -a --filter label=com.docker.compose.project=idraft-rehearsal -q | wc -l   # 0
```

### Task 10: Cutover (maintenance window, about 15 minutes)

Pick a quiet time. The site is down from Step 2 to Step 6.

All commands run on the host as root, in one fresh shell (no rehearsal variables), which starts with:

```bash
d=/srv/idraft/incoming/digests.json
export API_IMAGE="$(jq -r .api $d)" WORKER_IMAGE="$(jq -r .worker $d)" WEB_IMAGE="$(jq -r .web $d)"
dc() { docker compose -f /srv/idraft/infra/compose/docker-compose.yml --env-file /etc/idraft/.env "$@"; }
dump=/root/cutover-$(date -u +%Y%m%dT%H%MZ).dump
```

- [ ] **Step 1: Ready.** `docker pull "$API_IMAGE" "$WORKER_IMAGE" "$WEB_IMAGE"` succeeded (one at a time if your Docker takes one), so the window does not wait on downloads. `dc config -q` passes. Tell users the site is down for about 15 minutes.
- [ ] **Step 2: Stop writers.** `systemctl stop idraft-worker idraft-api idraft-web`. Check nothing holds a connection: `sudo -u postgres psql -p 5433 -Atc "select count(*) from pg_stat_activity where datname='idraft'"` → 0.
- [ ] **Step 3: Final dump.** `sudo -u postgres /usr/lib/postgresql/18/bin/pg_dump -p 5433 -Fc -d idraft --exclude-extension=pg_stat_statements > "$dump"`.
- [ ] **Step 4: Free the ports, for good.** `systemctl disable --now nginx`. Disabled, not only stopped: an unattended reboot (D5) would otherwise start nginx on 80 and 443 before Caddy.
- [ ] **Step 5: Database.** Redis is left to `deploy.sh`.

```bash
dc up -d postgres
until [ "$(dc ps --format '{{.Health}}' postgres)" = healthy ]; do sleep 2; done
dc exec -T -u postgres postgres pg_restore -d idraft --exit-on-error --single-transaction < "$dump"
mkdir -p -m 700 /root/cutover
sudo -u postgres psql -p 5433 -d idraft -At < /root/counts.sql > /root/cutover/host.counts
dc exec -T -u postgres postgres psql -d idraft -At < /root/counts.sql > /root/cutover/compose.counts
diff /root/cutover/host.counts /root/cutover/compose.counts && echo "counts match"
sudo -u postgres /usr/lib/postgresql/18/bin/pg_dump -p 5433 -s -d idraft --exclude-extension=pg_stat_statements | grep -vE '^(-- Dumped|\\(un)?restrict )' > /root/cutover/host.schema
dc exec -T -u postgres postgres pg_dump -s -d idraft --exclude-extension=pg_stat_statements | grep -vE '^(-- Dumped|\\(un)?restrict )' > /root/cutover/compose.schema
diff /root/cutover/host.schema /root/cutover/compose.schema && echo "schema, owners and grants match"
```

Both "match" lines, or go to Step 8.
- [ ] **Step 6: Deploy.** `/srv/idraft/infra/deploy.sh /etc/idraft/.env "$d"`. Expected: migrator applies 0017, api, worker, web and caddy healthy, "/api/v1/me 401" and "/api/readyz 200" through Caddy, release recorded in `/srv/idraft/releases/current.json`. Caddy gets its certificate from Let's Encrypt on first start (HTTP-01 on port 80); the probe allows 60 s.
- [ ] **Step 7: Verify from outside.** From the Mac: `curl -sS -o /dev/null -w '%{http_code}\n' https://app.idraft.ai/api/healthz` → 200; `https://app.idraft.ai/login` → 200 with a Let's Encrypt certificate (`curl -vI` shows the issuer); `GET /api/internal/health` with the token → 200, `"release"` is the release sha, migrations `0017`, worker reporting. The owner signs in and opens a project.
- [ ] **Step 8: If any step from 5 on fails: go back.** In the same shell:

```bash
dc down -v            # the new volumes hold nothing the host database does not; a retry needs them empty
systemctl enable --now nginx
systemctl start idraft-api idraft-worker idraft-web
curl -sS -o /dev/null -w '%{http_code}\n' https://app.idraft.ai/api/healthz   # 200
```

The host database was not written after Step 2, and 0017 ran only inside the container, so the old install comes back as it was. Find the cause from `/srv/idraft/releases/deploy.log` and `dc logs`, fix it, and redo the window from Step 2.
- [ ] **Step 9: Retire the old install** (only after Step 7 passed):

```bash
systemctl disable --now idraft-api idraft-web idraft-worker redis-server certbot.timer
for v in 16 18; do
  systemctl disable --now "postgresql@$v-main"
  echo manual > "/etc/postgresql/$v/main/start.conf"   # the cluster wrapper otherwise starts it at boot
done
systemctl disable --now postgresql
```

After a reboot, only Docker's containers should listen on 80 and 443: `ss -ltnp | grep -E ':(80|443) '` shows `docker-proxy`. Keep `/srv/idraft/backend`, `/srv/idraft/web`, `/srv/idraft/web.prev`, `/var/lib/postgresql/18`, `/etc/idraft/*.env` and the cutover dump for 7 days, then delete them on the owner's word.

### Task 11: First deploy through GitHub Actions

- [ ] **Step 1: ENV_FILE (owner).** The secret must equal the live env:

```bash
ssh root@187.126.121.25 'cat /etc/idraft/.env' | gh secret set ENV_FILE --env production
```

- [ ] **Step 2: Run the pipeline.** `gh workflow enable deploy.yml`, then `gh workflow run deploy.yml -f api_image=<api digest> -f worker_image=<worker digest> -f web_image=<web digest>` (the same release, so nothing changes). Expected: the job passes; `/srv/idraft/releases/history.log` gets a second line.
- [ ] **Step 3: The rollback command path runs.** `gh workflow run deploy.yml -f rollback=true` passes and the site stays up. Both records hold the same release at this point, so this proves the path (SSH, sudo rule, env handling), not a version change; the first real rollback test is after the next release.
- [ ] **Step 4: Drop the local deploy key.** It is root on the host in effect (`infra/README.md`, "What the guards do and do not cover"). Once the secret works: `rm ~/.ssh/idraft-deploy`. Keep `~/.ssh/idraft-deploy.pub` and `~/.ssh/idraft-known-hosts`.

### Task 12: Close out

- [ ] **Step 1: Branch protection on `main` and `develop`:** pull request required for `main`, required checks `checks` (backend), `checks` (web) and `lint` (infra) as they are named in the PR checks, no force pushes. Turn on "Allow auto-merge" for the repository.
- [ ] **Step 2:** After the 7 days of Task 10 Step 9 and on the owner's word, delete the old install (this also removes the stray `._*` files in `/srv/idraft/backend`).

## Not in this plan

- Nightly encrypted database backup to R2 (`docs/23-backup-disaster-recovery.md`). The cutover moves the data into the `pgdata` volume, so this is the next plan and should follow within days.
- Speeding up the web CI job (about 12 minutes).
- Uptime monitoring that calls `/api/internal/health`.

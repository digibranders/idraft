# Production Runtime (Build Step 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make idraft.ai run the way a product runs: the same stack on every machine from one command, a deploy that is a merge and a click, nightly backups that have been restored at least once, and the worker collecting real rank data every day under a hard spend cap.

**Architecture:** Docker Compose on the existing single host (a Hostinger VPS shared with a second project, idraft capped at an 8 GB share, [ADR-023](../../adr/ADR-023-shared-hostinger-vps.md), 2026-10-31), as ADR-022 and `docs/22-infrastructure-devops.md` already decide, with Caddy in front, images built in CI and pulled by digest, secrets written by the deploy workflow, and PostgreSQL dumps encrypted with age to Cloudflare R2. The live server today is a hand-built systemd and nginx install; this plan replaces it with the documented design through a short, reversible cutover.

**Tech Stack:** Docker Engine and Compose plugin, Caddy 2, PostgreSQL 18, Redis, GitHub Actions and GHCR, age, Cloudflare R2, Healthchecks.io, Sentry, Bash (shellcheck clean).

**Owner of this plan:** engineering lead. **Status:** proposed 2026-10-28, not started. **Builds on:** `docs/superpowers/plans/2026-10-05-rank-collection.md` (merged), `docs/29-phase-roadmap.md` section 1.1 step 6.

---

## 1. Why this, why now

Steps 1 to 5 built the product's brain: workspaces, entities, keywords and rank collection, with 2,847 web tests, 3,674 backend tests and 82 end-to-end tests green on `main`. None of it produces a single real rank today, for three reasons that are all runtime problems, not code problems:

1. **No worker runs on the server.** Rank collection is a worker workload. The live site can sign people in and show screens, and nothing collects.
2. **The server is a snowflake.** It was assembled by hand on 2026-10-28 (systemd, nginx, host-level Postgres 18 and Redis 7, secrets in `/etc/idraft`). If this VPS dies or expires, rebuilding it is a day of manual work from memory.
3. **There is no safety net.** No backups, no deploy pipeline, no health checks, no error reporting, no spend cap in force.

Step 7 (SEO analytics) and everything after it are worth only as much as the data under them. The roadmap's acceptance for rank collection ("5,000 keywords for 14 consecutive days, at least 98% ingested") says explicitly that it needs this step. So step 6 is the critical path, and it is also the cheapest risk reduction available.

## 2. Verified current state (2026-10-28)

Everything in this table was checked on the live host or in the repository on this date.

| Area | Today | Target (this plan) |
|---|---|---|
| Host | Hostinger VPS 187.126.121.25, Ubuntu 24.04, 4 vCPU, 16 GB RAM (15.6 GiB visible), 193 GB disk, 2 GB swap. Shared with a second project; idraft gets about half (8 GB). Plan price, snapshots and expiry are the owner's concern (D-H1); the plan treats the host as replaceable | Same host, idraft confined to `idraft.slice` (8 GB, fair-share CPU) behind a shared host-level edge proxy; rebuildable on a fresh one by `infra/bootstrap.sh` in under 30 minutes. Later moves to its own 16 GB or 32 GB VPS |
| Runtime | systemd units `idraft-web` and `idraft-api`, nginx, Python venv, Node bundle copied by hand | Docker Compose: `caddy`, `web`, `api`, `worker`, `postgres`, `redis`, one-off `migrator` |
| Domain | `app.idraft.ai` (A record, DNS only). The apex `idraft.ai` is a separate live marketing site on other IPs and must not be touched | Same. `docs/22` section 1 says the app lives on the apex; this plan amends that (decision D2) |
| Database | Separate PostgreSQL 18 cluster on `127.0.0.1:5433`; roles created by `infra/compose/postgres/initdb/10-roles.sh`; migrations at 0013 | `postgres:18` container, same role script, no host port |
| Redis | Ubuntu Redis 7 with a password | `redis:8` container with ACL users and AOF per `docs/22` section 4.3 |
| Email | Brevo, sender `hello@idraft.ai` (added to the backend on 2026-10-28, `EMAIL_PROVIDER=brevo`) | Unchanged; ADR note (D5) |
| Worker | Not running | Running, both queues, heartbeat watched |
| Secrets | Hand-written files in `/etc/idraft`, root only | One `.env` written by the deploy workflow from GitHub Environment secrets (`docs/22` section 7) |
| CI | `backend.yml` builds the API image and runs `backend/smoke.sh`; `web.yml` runs lint, types, tests, build. No deploy job. No worker or web image is built | CI builds three images, pushes to GHCR by digest, and a gated `deploy.yml` ships them |
| Backups | None | Nightly encrypted dump to R2, monthly restore drill (`docs/23`) |
| Monitoring | None | Sentry, Healthchecks heartbeats, one external uptime check, `ops_health` job (`docs/22` section 9, `docs/25`) |
| Data | No DataForSEO credentials, no R2 `seo-raw` bucket configured | Both configured, spend cap set, first real keywords tracked |
| Accounts | Registration is by invitation. No user exists yet | First operator created by the CLI runbook, then invitations |

## 3. Goals and non-goals

**Goals**
- G1. One command bootstraps a clean host; one workflow deploys a merged commit.
- G2. The stack on the server is the documented Compose stack, with parity between laptop, CI smoke test and production.
- G3. Real rank collection runs daily for a small set of keywords under a hard budget, and is observable.
- G4. Backups exist, are encrypted, and have been restored once into a scratch database.
- G5. The cutover from the hand-built install costs at most 10 minutes of downtime and can be undone in 5.
- G6. idraft stays inside its 8 GB share and cannot starve, or be starved by, the second project on the same host (ADR-023).

**Non-goals (explicit, to stop scope creep)**
- No Kubernetes, managed databases, multi-host or high availability. One host is a recorded decision (ADR-002, ADR-022, ADR-023).
- No changes to the second project. Host-level changes that touch it (edge proxy, firewall) are agreed with its owner first (D-H4).
- No new product features. Step 7 (SEO analytics) is a separate plan; section 12 lists what it needs from this one.
- No migration of the marketing site on the apex.
- No Prometheus or Grafana (`docs/22` section 9.1).
- Two-factor enforcement, resend and decline invitations and the other deferred items of `docs/29` section 1.1 stay deferred.

## 4. Decisions

Each decision has the choice, the reason, and what was rejected. Reverse one only with an ADR.

**D1. Move to Docker Compose now, on this host.** The repo already has the API Dockerfile, the web Dockerfile, a CI smoke test and a complete Compose design in `docs/22`. A containerized stack is portable to the next VPS (the expiry risk), gives rollback by image digest, and makes laptop, CI and production the same thing. *Rejected: keep systemd and script it.* It would mean maintaining a second, undocumented topology, and every future rebuild repeats the hand work. *Cost accepted:* about two days of work and one short cutover.

**D2. Domain is `app.idraft.ai`, not the apex.** The apex serves a live marketing site, so the product takes the subdomain. Caddy serves only `app.idraft.ai`. All references to `https://idraft.ai` for the app, the API origin (`APP_ORIGIN`) and Google OAuth redirects (later) use `https://app.idraft.ai`. `docs/22` section 1 and ADR-022 get an amendment note (WP7).

**D3. Caddy replaces nginx.** ADR-022 decides Caddy (automatic HTTPS, one config file, no certbot cron). The current nginx and certbot setup is removed during cutover. *Rejected: keep nginx.* Two proxies in the docs and one in production is exactly the drift this plan removes.

**D4. Images are built in CI and pulled by digest.** Names `ghcr.io/digibranders/idraft-api`, `idraft-worker`, `idraft-web`. The deploy references digests, never `latest`, so a deploy is reproducible and a rollback is "deploy the previous digest". The repo is private, so the host pulls with a read-only token stored as a deploy secret.

**D5. Email stays Brevo.** The backend gained a Brevo sender (`backend/src/idraft/providers/email.py`, merged 2026-10-28), with the same guarantees as the Resend one. The sender address is `hello@idraft.ai`. `docs/22`, `docs/24` and the settings doc get a one-line note.

**D6. Secrets flow from GitHub Environment secrets to one root-only file.** `/etc/idraft/.env`, mode 0600, written by the deploy job over SSH, interpolated by Compose (`docs/22` section 7.3). No secret is committed, logged or baked into an image. The hand-made files under `/etc/idraft/*.env` are removed after cutover. The Brevo, TOTP and database secrets that exist today are carried over once, by the owner, not regenerated: regenerating the TOTP key would make stored two-factor secrets unreadable.

**D7. Spend is capped before data is switched on.** DataForSEO credentials are added only after a workspace budget exists in the database with a hard cap (start at 15 USD per month) and a soft limit at 80%, and after the budget check is verified to block a dispatch in a test. First collection is 200 keywords for 14 days, then scale, so the 14-day soak of `docs/29` costs about 8 USD a month at the price book rate, not 90.

**D8. One worker container, both queues.** As ADR-022. No split until a trigger in `docs/22` section 11 fires.

**D9. Host tuning follows the 8 GB profile (amended 2026-10-31 by ADR-023).** The first version of this decision sized Postgres for a whole 15 GB host (`shared_buffers=3GB`, `effective_cache_size=9GB`, `maintenance_work_mem=512MB`, `max_connections=100`, `shm_size: 1gb`); that was written before the host was known to be shared and is superseded. The 8 GB profile is the baseline and is written into `infra/compose/postgres/postgresql.conf` and `profiles/8gb.env`: Postgres `mem_limit` 3000m, `shared_buffers=2GB`, `effective_cache_size=5GB`, `work_mem=16MB`, `maintenance_work_mem=256MB`, `max_connections=80`, worker `mem_limit` 768m, Redis `maxmemory 512mb`, `noeviction`, AOF `everysec`. The sum of container limits stays under the 7 GB soft limit of `idraft.slice`. The 4 GB profile is for laptops and CI.

**D11. Shared host (ADR-023).** `idraft.slice` (`MemoryHigh=7G`, `MemoryMax=8G`, `CPUWeight=100`) with `cgroup_parent: idraft.slice` on every service; `caddy` becomes the loopback-only application gateway; one host-level edge proxy owns ports 80 and 443 for both projects (open decision D-H2: nginx or host-level Caddy); firewall is Hostinger hPanel plus ufw; Hostinger snapshots are a second copy after the R2 dump (verify in hPanel).

**D10. Rollout is progressive, in this order:** build and verify everything on a laptop under Colima, then on the server beside the live install on different ports, then cut over. The live site is never the first place a new file runs.

## 5. Ownership and safety boundary

This plan is written to be split between two kinds of worker, because the risk is different.

| Work | Who | Why |
|---|---|---|
| Repo artifacts: Dockerfiles, Compose files, Caddyfile, scripts, workflows, docs, tests | Coding agent (Gemini or Claude), on a branch, reviewed by Claude on the Opus model before merge | Pure code. Verifiable on a laptop |
| Anything that touches the live server, a secret or an external account | Owner and Claude, together | Irreversible or sensitive |

**Hard rules for the coding agent.** It does not SSH to any server. It does not read, create or print real secrets (use the placeholder values in `infra/compose/.env.example`). It does not create cloud accounts, tokens or buckets. It does not push to `main`; it works on a branch and opens a pull request. If a task seems to need any of the above, it stops and says so.

## 6. Work packages

Packages are ordered; each ends with the gates (section 9), a Claude review on the Opus model, fixes, and a commit. WP1 to WP3 are one delivery ("Delivery 1"), WP4 to WP5 and WP7 a second ("Delivery 2"), WP6 and the cutover are done with the owner.

### WP1. Images: worker and web built and published by CI

**Files**
- Modify: `backend/Dockerfile` (add `worker` and `migrator` targets)
- Modify: `.github/workflows/backend.yml` (build and push `api` and `worker`)
- Modify: `.github/workflows/web.yml` (build and push `web`)
- Create: `.github/workflows/images.yml` only if the two workflows cannot share a reusable job cleanly
- Test: `backend/smoke.sh` (already exercises the worker; extend it to run the `worker` target image)

- [ ] **Step 1.** Add `FROM runtime AS worker` with `CMD ["python", "-m", "idraft.worker"]` and `FROM runtime AS migrator` with `CMD ["python", "-m", "idraft.db.migrate"]`. Both reuse the `runtime` stage, so the three images share one layer set.
- [ ] **Step 2.** In `smoke.sh`, build and run each target the way production does: migrator first with only `DATABASE_URL`, then api, then worker. The existing assertions stay (`/api/readyz` 200, worker heartbeat fresh, SIGTERM exit code 0).
- [ ] **Step 3.** In CI, on pushes to `main` only, log in to GHCR with `GITHUB_TOKEN`, build with `docker/build-push-action`, tag with the full commit SHA, and write each image digest to the job summary and to an artifact `digests.json`. Pull requests build but do not push.
- [ ] **Step 4.** Web image: `apps/web/Dockerfile` already exists. Build it with `NEXT_PUBLIC_APP_ENV=production` and `NEXT_PUBLIC_API_MOCKING=off` as build args (the environment schema refuses mock mode in production, which is the safety we want).
- **Acceptance:** a push to `main` produces three images in GHCR and a `digests.json` artifact; `smoke.sh` passes for all three targets; a pull request pushes nothing.

### WP2. The production Compose stack

**Files**
- Create: `infra/compose/docker-compose.yml`
- Create: `infra/compose/Caddyfile`
- Create: `infra/compose/postgres/postgresql.conf`, `infra/compose/redis/redis.conf`
- Create: `infra/compose/.env.example` (every variable the stack reads, placeholder values, one comment per variable saying where it comes from)
- Keep: `infra/compose/docker-compose.dev.yml` and `infra/compose/postgres/initdb/10-roles.sh` unchanged (the role script is shared by production, dev, smoke and the test suite by design)

- [ ] **Step 1.** Services: `caddy` (the application gateway; per D11 it binds `127.0.0.1` only, with automatic HTTPS off, once the shared edge proxy exists; on a laptop it still publishes 80 and 443), `web`, `api`, `worker`, `postgres` (`postgres:18`, volume at `/var/lib/postgresql`, the shared role script mounted into `docker-entrypoint-initdb.d`), `redis` (`redis:8` with the ACL and config file), and `migrator` (`restart: "no"`, `depends_on` postgres healthy, run explicitly by the deploy script).
- [ ] **Step 2.** Every long-running service has a healthcheck and a memory limit. The API check is `/api/readyz`; the worker check is the heartbeat file read by `python -m idraft.worker.healthcheck`; web is an HTTP check on its own port; Postgres is `pg_isready`; Redis is `redis-cli ping` with the ACL user.
- [ ] **Step 3.** Images are referenced by `${API_IMAGE}`, `${WORKER_IMAGE}`, `${WEB_IMAGE}` (full `ghcr.io/...@sha256:...` strings supplied by the deploy), never a tag.
- [ ] **Step 4.** `Caddyfile`: site `app.idraft.ai`, `/api/*` to `api:8000`, everything else to `web:3000`, security headers (`Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`), request body limit 60 MB (the import upload) with the API's own 1 MB body rule still enforced by the API, gzip and zstd encoding, access log to stdout as JSON.
- [ ] **Step 5.** Networks: one internal network for everything; only Caddy is attached to the host, on loopback. Postgres and Redis publish nothing.
- [ ] **Step 6.** Settings the API and worker read are exactly the ones in `backend/src/idraft/config/settings.py` (`DATABASE_URL`, `REDIS_URL`, `APP_ENV=production`, `APP_ORIGIN=https://app.idraft.ai`, `TOTP_ENCRYPTION_KEY`, `EMAIL_PROVIDER=brevo`, `EMAIL_API_KEY`, `EMAIL_FROM`, `SENTRY_DSN`, and for the worker only `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `R2_RAW_ENDPOINT`, `R2_RAW_BUCKET`, `R2_RAW_ACCESS_KEY_ID`, `R2_RAW_SECRET_ACCESS_KEY`, `HEARTBEAT_FILE`). The worker has no `EMAIL_*` need today; do not give it the key.
- [ ] **Step 7.** Local verification target: `docker compose -f infra/compose/docker-compose.yml --env-file infra/compose/.env.local up` under Colima with throwaway secrets serves the sign-in page on `https://localhost` (Caddy internal CA) and the API answers 401 on `/api/v1/me`.
- **Acceptance:** the stack comes up on a clean laptop from the example env; every container reports healthy; `docker compose config` is clean; no service other than Caddy publishes a port; there are no secrets in any committed file.

### WP2b. Shared-host changes (ADR-023; added 2026-10-31)

**Files**
- Create: `infra/host/idraft.slice` (systemd slice unit), `infra/compose/profiles/8gb.env` and `infra/compose/profiles/4gb.env`
- Modify: `infra/compose/docker-compose.yml`, `infra/bootstrap.sh`, `infra/README.md`
- Create (after D-H2): the edge proxy site file for the idraft hostnames

- [ ] **Step 1.** Slice unit: `idraft.slice` with `MemoryHigh=7G`, `MemoryMax=8G`, `CPUWeight=100`, installed and enabled by `bootstrap.sh`. Verify with `systemctl show idraft.slice` and `systemd-cgls`.
- [ ] **Step 2.** Compose: add `cgroup_parent: idraft.slice` to every service next to its `mem_limit`. Verify that `docker stats` and `systemd-cgtop` show the containers under the slice, and that a memory hog in a test container is killed at the cap without touching the host.
- [ ] **Step 3.** Loopback gateway: bind `caddy` to `127.0.0.1:${GATEWAY_PORT}`, automatic HTTPS off, trust the client address header only from loopback. Verify with `ss -ltnp` that nothing of idraft listens on a public address.
- [ ] **Step 4.** Edge proxy decision D-H2 (owner and the second project's owner): nginx (already on the host) or host-level Caddy for TLS and hostname routing of both projects. Write the decision into doc 30 and ADR-023, then add the idraft site file (hostname `app.idraft.ai` to the loopback gateway, set `X-Forwarded-For`). The apex marketing site stays untouched.
- [ ] **Step 5.** Sizing profile: add `profiles/8gb.env` (baseline) and `profiles/4gb.env` (laptop and CI); the deploy selects the profile; Postgres and worker limits read from it (D9).
- [ ] **Step 6.** Firewall: in Hostinger hPanel allow SSH (restricted as in doc 22 section 6), 80 and 443, deny the rest; mirror it with ufw in `bootstrap.sh`. Verify in hPanel which firewall features the plan has; do not assume.
- [ ] **Step 7.** Snapshot before cutover: take a Hostinger snapshot in hPanel (verify in hPanel that the plan includes it and how long it is kept) and record its name and date in the cutover notes. It is a second copy only; the pre-cutover `pg_dump` off the host is still required.
- [ ] **Step 8.** Isolation checks against the second project: distinct Compose project name, networks, deploy user and secret files; no port clash; disk and memory alerts count both projects.
- **Acceptance:** `idraft.slice` is active and holds every idraft container; the stack stays under 7 GB at the end of the dry run; the public ports 80 and 443 are served only by the edge proxy; the second project is unaffected by a deploy and a forced idraft restart.

### WP3. Bootstrap, deploy and rollback scripts, and the deploy workflow

**Files**
- Create: `infra/bootstrap.sh` (idempotent)
- Create: `infra/deploy.sh` (runs on the host)
- Create: `.github/workflows/deploy.yml`
- Create: `infra/README.md` (the operator's page: bootstrap, deploy, rollback, first operator, secrets)
- Test: `infra/test/deploy-dryrun.sh` (shellcheck plus a dry run against a local Compose project)

- [ ] **Step 1.** `bootstrap.sh`: install Docker Engine and the Compose plugin from Docker's apt repository; create the `deploy` user (no password, key only) and an `/srv/idraft` tree; 2 GB swap; unattended upgrades with a reboot window; fail2ban for SSH; firewall (ufw; Hostinger hPanel firewall alongside, see WP2b) allowing 22, 80, 443 only; SSH hardening (no root login, key auth only) applied last and only after a second key is confirmed working. Re-running it changes nothing.
- [ ] **Step 2.** `deploy.sh <env-file> <digests.json>`: (1) pull the three images by digest, (2) run the migrator as a one-off and stop on failure, (3) `compose up -d` api, worker, web, caddy in that order, waiting for each healthcheck, (4) call `/api/readyz` through Caddy, (5) on any failure, redeploy the previous digests recorded in `/srv/idraft/releases/previous.json` and exit non-zero. Every successful deploy appends a line to `/srv/idraft/releases/history.log`.
- [ ] **Step 3.** `deploy.yml`: triggered by `workflow_dispatch` and by a successful `backend` plus `web` workflow on `main`, using the GitHub Environment `production` with a required reviewer. It downloads `digests.json`, writes `/etc/idraft/.env` from environment secrets over SSH (mode 0600, atomic move), copies `infra/` to the host, runs `deploy.sh`, and fails the job if the health gate fails. SSH uses a dedicated deploy key stored as an environment secret.
- [ ] **Step 4.** Rollback is one command, documented: `infra/deploy.sh --rollback`. It must work with the database one migration ahead; therefore every migration from now on is backward compatible with the previous release (expand then contract). Add this rule to `backend/README.md`.
- **Acceptance:** `shellcheck` is clean on every script; `deploy-dryrun.sh` passes locally; a deploy to a scratch project name on the laptop succeeds and a forced failure (bad digest) rolls back automatically.

### WP4. Backups and the restore drill

**Files**
- Create: `infra/backup/pg-backup.sh`, `infra/backup/pg-restore-drill.sh`, `infra/backup/systemd/` units and timers
- Create: `infra/backup/README.md` (custody of the age key, rotation, restore steps)
- Reference: `docs/23-backup-disaster-recovery.md` sections 5 to 8, which already contain the design and a reference script

- [ ] **Step 1.** Implement the nightly job per `docs/23` section 6: `pg_dump -Fc` as the `backup` role, `age` encryption to the recipient key, upload to `seo-backups/daily/`, 30-day lifecycle on the bucket, a Healthchecks ping on success and on failure.
- [ ] **Step 2.** The restore drill restores the newest dump into a scratch database (never the live one), runs a row-count and schema checksum comparison against the live database, drops the scratch database, and pings a second Healthchecks check. It is a monthly timer and a manual command.
- [ ] **Step 3.** Keys: the age identity (private key) is generated by the owner, stored in the owner's password manager and one offline copy, and never placed on the server. Only the public recipient is deployed.
- **Acceptance:** a dump is created, encrypted, uploaded and listed; the drill restores it and reports matching counts; the job fails loudly (non-zero exit and a failed ping) if R2 is unreachable.

### WP5. Observability and runbooks

**Files**
- Modify: backend and web Sentry initialization only if not already wired (check `backend/src/idraft/config` and `apps/web` first; the settings already carry `SENTRY_DSN`)
- Create: `infra/monitoring/host-check.sh` and its timer (disk, memory, container restarts, certificate days left)
- Create: `docs/runbooks/` pages for: restart a service, rollback, rotate a secret, restore a backup, a stuck queue, a provider outage, disk full
- Reference: `docs/22` section 9, `docs/25-observability.md`

- [ ] **Step 1.** Healthchecks: one check per heartbeat (worker tick, backup, restore drill, host check). Alerts go to the owner's email first, a chat channel later.
- [ ] **Step 2.** One external uptime check (Better Stack free tier) on `https://app.idraft.ai/login` and on `/api/readyz`.
- [ ] **Step 3.** `ops_health` (the in-app 5-minute job in `docs/22` section 9.3) is verified against a stopped worker: stop it in a test project and see the alert fire.
- [ ] **Step 4.** Log rotation: Docker `json-file` with `max-size` and `max-file` per `docs/22` section 5.3.
- **Acceptance:** killing the worker produces an alert within 10 minutes; a full-disk simulation (fill a loop device) produces a host-check alert; each runbook has been executed once on the laptop stack.

### WP6. Switch the data on (done with the owner; not for the coding agent)

Prerequisites the owner provides: Cloudflare R2 buckets `seo-raw` and `seo-backups` with separate API tokens, a funded DataForSEO account, a Sentry DSN, Healthchecks.io account, Better Stack account.

- [ ] **Step 1.** Add the secrets to the GitHub Environment `production`; redeploy; confirm the worker starts and reports healthy with R2 configured and no provider credentials yet.
- [ ] **Step 2.** Create the first operator: `python -m idraft.cli create-operator --email ... --name ...` run in the `api` image with the migrator database URL (the exact command goes into `infra/README.md`, and is the one in `backend/README.md` section "Signing in locally"); the owner types the password. Sign in at `https://app.idraft.ai`, create the workspace and project, invite the team.
- [ ] **Step 3.** Create the budget (D7): hard cap 15 USD per month, soft limit 80%. Prove the cap by lowering it to 0.01 USD in a throwaway project and observing a blocked dispatch ("budget blocked" on the Runs screen).
- [ ] **Step 4.** Add the DataForSEO credentials, add 20 real keywords, press Check now, and verify the chain end to end: task submitted, `tasks_ready` polled, payload stored in `seo-raw`, snapshot ingested, rank visible on the Keywords page, cost recorded and matching the price book within 5%.
- [ ] **Step 5.** Raise to 200 keywords and start the 14-day soak (acceptance in section 10).

### WP7. Documents and decisions

- [ ] Amend `docs/22-infrastructure-devops.md` (domain `app.idraft.ai`, 8 GB profile values for the shared host (ADR-023), Brevo, Ubuntu 24.04 as run), `docs/adr/ADR-022` (one dated amendment), `docs/24-security.md` (Brevo key handling), `docs/29-phase-roadmap.md` (step 6 as built, rank collection soak status), `docs/31-implementation-checklist.md` (tick what is done).
- [ ] Add `docs/review-log.md` entries for every deviation from the written design with the reason and the date.

## 7. Cutover runbook (owner and Claude, about 30 minutes, 10 minutes of downtime)

Preconditions: WP1 to WP3 merged, WP4 backup dry run done, secrets in the GitHub Environment, a fresh dump of the live database taken by hand (`pg_dump -Fc` on port 5433) and copied off the host.

1. Announce the window. A second project runs on this host and must not be disturbed; the apex marketing site is elsewhere. Take the Hostinger snapshot first (WP2b step 7).
2. Run `bootstrap.sh` on the host (installs Docker, leaves the running install alone).
3. Bring the new stack up on alternate ports (`COMPOSE_PROJECT_NAME=idraft-next`, Caddy on 8081 and 8443, no TLS) using the same database dump restored into the new Postgres container. Run the smoke checks and `readyz` against it.
4. Stop the old services: `systemctl stop idraft-web idraft-api nginx`. Take a last dump of the old database and restore it into the new container (the delta since step 3 is minutes).
5. Add the idraft site to the shared edge proxy (80 and 443) pointing at the loopback gateway; the edge proxy obtains the certificate for `app.idraft.ai` (HTTP-01). Do not stop the second project's services. Verify `https://app.idraft.ai/login`, sign in, load the Keywords page.
6. Leave the old install stopped but intact for 7 days (units disabled, venv and bundle kept, old Postgres cluster kept). Rollback is `systemctl start` of the old units and stopping Caddy.
7. After 7 clean days: remove nginx, certbot timers, the old units, the old cluster and the hand-made env files, in that order.

## 8. Test strategy

| Level | What | Where |
|---|---|---|
| Static | `shellcheck` on every script, `docker compose config`, `actionlint` on workflows | CI job `infra` (new) |
| Image | `backend/smoke.sh` for api, worker and migrator; a web image health probe | `backend.yml`, `web.yml` |
| Stack | Compose up under Colima with throwaway secrets; sign-in page, API 401, worker healthy, one end-to-end Playwright flow against it | New script `infra/test/stack-smoke.sh`, run locally and by a nightly workflow |
| Deploy | Forced bad digest rolls back; a migration failure leaves the previous release serving | `infra/test/deploy-dryrun.sh` |
| Backup | Dump, encrypt, restore, compare | Monthly drill and the manual command |
| Data | First real collection chain and cost check (WP6 step 4) | Production, with the owner |

## 9. Quality gates for every package

Run and report: `cd backend && ./check.sh`; `cd apps/web && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`; `NEXT_PUBLIC_API_MOCKING=off pnpm build`; `shellcheck` on new scripts; a dash scan (`grep -nP "\x{2014}|\x{2013}"`) on every file written; then an independent review on the Opus model, fixes, and the gates again. Backend database tests need Docker; on a Mac with Colima, set `DOCKER_HOST=unix://$HOME/.colima/default/docker.sock` and `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`.

## 10. Acceptance criteria for the whole step

1. A clean host reaches a working stack with `bootstrap.sh` then one deploy, in under 30 minutes, from the repository alone and the secrets.
2. A merge to `main` produces three images; a reviewed deploy ships them by digest; a failed health gate rolls back on its own; a manual rollback works.
3. `https://app.idraft.ai` is served by Caddy with a valid certificate that renews on its own; nothing but Caddy listens on a public port; the database and Redis are unreachable from outside.
4. The nightly backup has run for 7 consecutive days and one restore drill matched the live database.
5. Killing the worker raises an alert in 10 minutes; the uptime check pages on an API outage.
6. Rank collection for 200 keywords runs for 14 consecutive days with at least 98% of checks ingested inside the window plus 6 hours, zero duplicate snapshots, and cost within 5% of the price book. Spend never exceeds the hard cap.
7. The hand-built install is removed after 7 clean days; the documents say what is true.

## 11. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Cutover breaks sign-in (cookie or origin mismatch behind Caddy) | Medium | High | Step 3 of the cutover tests the full stack on alternate ports first; the old install stays intact for 7 days |
| Regenerated secrets invalidate stored data (TOTP key) | Low | High | D6: secrets are carried over once by the owner, never regenerated; documented in `infra/README.md` |
| DataForSEO spend surprise (deep checks, async AIO billing) | Medium | Medium | D7: hard cap before credentials, 200-keyword soak, daily cost reconciliation already built |
| Backups exist but cannot be restored | Medium | Critical | WP4 makes the restore drill part of the definition of done, not an afterthought |
| The second project exhausts memory, disk or CPU, or a host-level change breaks one project | Medium | High | `idraft.slice` memory cap, CPU weights, disk alerts counting both projects, per-project deploy users, R2 backups that do not depend on the host, D-H4 (owner of host-level changes) |
| The VPS expires or is lost | Medium | High | G1: rebuild from the repository; backups off-host in R2; the age key kept off the server |
| Private repo image pulls fail on the host (token expiry) | Low | Medium | Deploy fails before touching running containers; the pull token's expiry is in the runbook |
| Gemini changes files outside the brief or touches secrets | Low | High | Section 5 hard rules, branch-only work, Opus review before merge |
| Postgres 18 and Redis 8 container images drift | Low | Medium | Pin by digest in the Compose file; update deliberately |

## 12. What step 7 needs from this step

Step 7 (SEO analytics, `docs/29` Phase 5) is the next plan and starts when WP1 to WP3 are merged, since its rollups run on the worker. It does not wait for the 14-day soak: its frontend and metric regression work run on fixtures. Its first slices, to be planned separately, are: rollup jobs and `seo.daily_project_metrics`; the metric service returning `MetricValue` with denominators; the SEO Overview API and screen; alerts. Page performance (step 7b, `docs/32-page-performance.md`) stays proposed until the owner decides its place.

## 13. Open questions for the owner

1. Create the Cloudflare R2 account buckets (`seo-raw`, `seo-backups`) and tokens, and a funded DataForSEO account: who and when?
2. Is 15 USD per month the right hard cap for the 200-keyword soak?
3. Where do alerts go first: email only, or a chat channel as well?
4. Does the VPS have a known expiry date, so the first real rebuild drill can be scheduled before it? Also the Hostinger plan price and term, snapshot features and in-place upgrade options (D-H1, verify in hPanel).
5. Who holds the age private key for backups, and where is the offline copy?
6. Edge proxy: nginx or host-level Caddy (D-H2)? Who owns host-level changes, and what is the second project's name and expected resource need (D-H3, D-H4)?

## Self-review

- **Coverage:** every row of section 2's gap table maps to a package (runtime to WP2 and WP3, CI to WP1, backups to WP4, monitoring to WP5, data to WP6, documents to WP7); non-goals are listed.
- **Placeholders:** none; where a value is the owner's (R2 tokens, DSN, cap), section 13 asks for it.
- **Consistency:** image names, the domain `app.idraft.ai`, port numbers and file paths are the same in every section.

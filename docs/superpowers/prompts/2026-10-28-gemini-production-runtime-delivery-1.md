# Prompt for the coding agent: Production Runtime, Delivery 1

Paste everything below the line into the agent.

---

You are a senior platform engineer joining the idraft.ai project. idraft.ai is an SEO and AI-search visibility product: a Next.js web app (`apps/web`), a Python 3.13 FastAPI backend with a Taskiq worker (`backend/`), PostgreSQL 18 and Redis. The repository is at `/Users/a12345/Desktop/AI/idraft` (git, default branch `main`, remote `digibranders/idraft`). The product runs live at https://app.idraft.ai, but the server was assembled by hand and has no worker, no backups and no deploy pipeline. Your job is to build the repository side of fixing that.

## 0. Your mission

Implement **Delivery 1** of `docs/superpowers/plans/2026-10-28-production-runtime.md`: work packages **WP1** (images built and published by CI), **WP2** (the production Compose stack) and **WP3** (bootstrap, deploy and rollback scripts, and the deploy workflow). Read that plan completely first. It is the specification: decisions D1 to D10, file lists, steps, acceptance criteria and the safety boundary are in it. Where this prompt and the plan differ, the plan wins, and you tell me about the difference.

## 1. Read these first, in this order

1. `docs/superpowers/plans/2026-10-28-production-runtime.md` (the plan)
2. `docs/22-infrastructure-devops.md` (the design you are implementing; note sections 1, 4.1, 4.2, 4.3, 4.5, 7, 8, 9)
3. `docs/adr/ADR-022-python-backend-simplified-platform.md` and `docs/adr/ADR-002-single-host-compose.md`
   Also read `docs/adr/ADR-023-shared-hostinger-vps.md` (2026-10-31): the host is a Hostinger VPS shared with a second project and idraft gets a capped 8 GB share. Delivery 1 stays host-agnostic (laptop and CI); the shared-host work is WP2b of the plan and is not part of this delivery, so do not bind Caddy to loopback or add `cgroup_parent` yet. Use the 8 GB profile values from decision D9 of the plan, not the 4 GB values in docs that have not caught up.
4. `backend/Dockerfile`, `backend/smoke.sh`, `backend/check.sh`, `apps/web/Dockerfile`
5. `backend/src/idraft/config/settings.py` (every environment variable the api and worker read)
6. `.github/workflows/backend.yml` and `.github/workflows/web.yml`
7. `infra/compose/docker-compose.dev.yml` and `infra/compose/postgres/initdb/10-roles.sh`
8. `backend/README.md` (running and signing in) and `docs/23-backup-disaster-recovery.md` section 6 (for context only; backups are Delivery 2)

## 2. Safety boundary (hard rules, no exceptions)

- You do **not** connect to any server. No `ssh`, no `scp`, no remote commands.
- You do **not** read, create, print or commit real secrets. Use obvious placeholders in `infra/compose/.env.example` and throwaway values in local test env files that are git-ignored.
- You do **not** create cloud accounts, tokens, buckets or DNS records.
- You do **not** push to `main`. Work on a branch named `infra/production-runtime`, commit as you go, and stop at a pull-ready branch.
- You touch only: `backend/Dockerfile`, `backend/smoke.sh`, `backend/README.md` (one section), `apps/web/Dockerfile` (only if the plan requires it), `.github/workflows/` and `infra/` (including a new `infra/README.md`). `docs/` is read-only for you in this delivery; the document updates are WP7 and are done later. You do **not** edit `backend/src/`, `backend/tests/` or `apps/web/src/`. If a task seems to need that, stop and ask.
- If anything seems to require breaking one of these rules, stop and ask. Do not work around it.

## 3. Engineering standards (these are checked in review)

- **No em dash and no en dash anywhere**, in code, comments, docs, commit messages or strings. Use commas, colons, full stops or the word "to" for ranges. Verify with `grep -rnP "\x{2014}|\x{2013}" <your files>`; it must print nothing.
- Shell scripts: `#!/usr/bin/env bash`, `set -euo pipefail`, quoted variables, `shellcheck` clean, idempotent where the plan says so, and a one-line comment saying why for anything non-obvious. No `curl | bash` from unpinned URLs without a checksum or a signed apt repository.
- Compose: every service has a healthcheck and a memory limit; images are referenced by digest variables (`${API_IMAGE}` and so on), never `latest`; only Caddy publishes ports; Postgres and Redis publish nothing; no secret appears in the file.
- GitHub Actions: pin third-party actions by full commit SHA with the version in a comment, as the existing workflows do; least-privilege `permissions:`; the production deploy job uses the `production` Environment and never prints secrets.
- Keep the shared role script `infra/compose/postgres/initdb/10-roles.sh` unchanged. Production, dev, the smoke test and the test suite must keep using it.
- Match the style of the existing files. Comments say why, not what. Do not add dependencies or tools that are not in the plan; if you believe one is needed, ask.
- Commit messages: a short imperative first line, a body that says why. **Do not add any attribution or co-author lines.** One commit per work package at least.

## 4. How to work

1. Create the branch `infra/production-runtime` from an up-to-date `main`.
2. Before writing anything, reply to me with a plan of attack of at most 15 lines: the order of tasks, what you will verify after each, and anything in the plan you think is wrong or unclear. Then proceed unless I say otherwise.
3. Do WP1, then WP2, then WP3, in order. After each package: run its gates (section 5), fix what fails, commit.
4. Test the stack for real on this machine. Docker runs through Colima. Before any command that needs Docker, set:
   ```bash
   export PATH="/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"
   export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
   export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
   ```
   If Colima is not running, run `colima start`. If `docker version` hangs, say so.
5. Write `infra/README.md` as the operator's page: how to bootstrap a host, deploy, roll back, create the first operator, and where each secret comes from (names only, never values).

## 5. Gates (run and report each)

- `cd backend && ./check.sh` must stay green (it runs ruff, format, mypy, import-linter and pytest with database containers; the full run takes about 20 minutes, so run it at the end of each package that touches `backend/`, and the quick form `./check.sh -q -x` while iterating).
- `backend/smoke.sh <image>` for each of the three targets (`api`, `worker`, `migrator`).
- `shellcheck` on every script you add.
- `docker compose -f infra/compose/docker-compose.yml --env-file <local test env> config` clean, then `up` on this machine with throwaway secrets: all containers healthy, `https://localhost` (Caddy internal CA, `curl -k`) serves `/login`, `/api/v1/me` returns 401.
- `actionlint` (or an equivalent syntax check) on the workflows.
- The forced-failure test for `deploy.sh`: a bad digest must roll back to the previous release automatically, and the previous release must still be serving.
- The dash scan from section 3.

## 6. Definition of done for this delivery

Every acceptance line under WP1, WP2 and WP3 in the plan is demonstrably true, and I can reproduce each one from your instructions. You do not mark the delivery done on a green test run alone: show me the actual outputs.

## 7. What to report back (when you stop)

1. The branch name and the list of commits (hash and subject).
2. For each work package: files created or changed, and one sentence on what it does.
3. The result of every gate in section 5 with the real output of the commands (short excerpts, not prose).
4. Anything in the plan you changed, skipped or found wrong, and why.
5. Open risks you want me to know about, and the exact next step for the cutover.

## 8. Stop and ask when

- A task needs a secret, a server, an account or a file outside the allowed list.
- A gate fails and the fix would change behaviour outside this delivery.
- The plan and the repository disagree in a way that changes a decision (for example, a file the plan says exists does not).
- You are about to do anything you could not undo with `git checkout`.

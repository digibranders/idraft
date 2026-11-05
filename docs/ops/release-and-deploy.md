# Releases and deployment

How idraft goes live, since 2026-11-05. This is the only release path. If anything else in the repository
describes another one (GitHub Actions deploys, the Docker Compose stack, pull requests from `develop` to
`main`), that text describes a design that is not in use; this page wins.

## Rules

1. All work lands in `develop` and is pushed to `origin/develop`. Short-lived branches and worktrees are
   fine; merge them into `develop`.
2. `main` is what is live. Only `infra/ship.sh` pushes `main`. Never push, merge or open a PR into `main`
   any other way.
3. Release only when the owner says to release; "ship it" or "release" in chat counts. Shipping deploys to
   production.
4. One release at a time. Before running `infra/ship.sh`, check that no other one runs:
   `pgrep -f 'bash.*infra/ship.sh'` must print nothing (a plain `pgrep -f infra/ship.sh` also matches the
   shell you ask from). If another agent session may ship, agree with it first.
5. Never deploy by hand: no copying files to the server, no editing the release folders, no restarting the
   `idraft-*` units outside this runbook.
6. The GitHub Actions workflows `backend`, `web`, `infra` and `deploy` are disabled on purpose. Do not
   enable them, and do not treat a red or missing GitHub check as a release blocker.

## The moving parts

| Where | What |
|---|---|
| Owner's Mac (Apple silicon, 14 cores) | `infra/ship.sh`, the release worktree `.claude/worktrees/release`, Docker through Colima (10 CPUs, 16 GiB) for the backend tests |
| GitHub `digibranders/idraft` | `develop` (integration) and `main` (live). Workflows disabled. |
| VPS `root@187.126.121.25` (Ubuntu 24.04) | `app.idraft.ai`: systemd units `idraft-api` (127.0.0.1:8000), `idraft-worker`, `idraft-web` (127.0.0.1:3010), nginx on 80/443 with a certbot certificate, PostgreSQL 18 on 127.0.0.1:5433 (database `idraft`), Redis on 127.0.0.1:6379 |
| Server-side script | `/usr/local/sbin/idraft-activate`, installed from `infra/vps/activate.sh` by every release |

The marketing site (`idraft.ai`) is not part of this repository any more: it lives in
`digibranders/idraft-site` and Vercel deploys it from there.

## Releasing

From any checkout of the repository on the Mac, not from inside `.claude/worktrees/release` (the script
resets and cleans that worktree on every run, so nothing of yours may live there):

```bash
colima status || colima start --cpu 10 --memory 16    # the backend tests need Docker
infra/ship.sh
```

A release takes about 8 minutes; an agent runs it in the background and reads its output when it ends.

What it does, in order:

1. Fetches `origin`, resets `.claude/worktrees/release` to `origin/main` and merges `origin/develop` into it.
   A conflict stops here: resolve it on `develop`. If the `infra/ship.sh` you started differs from the one in
   the release (a checkout whose `develop` lags behind), it hands over to the release's copy and starts
   again, so the newest release logic always runs. Copies older than develop `403a59f` lack this and fail
   from the main checkout with `cd: ../.git/..`: start from an up-to-date worktree once.
2. Works out which parts changed since `origin/main`, and which parts the VPS serves an older commit of:

   | Part | Paths | Checks |
   |---|---|---|
   | backend | `backend/`, `infra/compose/postgres/initdb/` | `backend/check.sh -n 8`: ruff, ruff format, mypy, import contracts, pytest (about 4,100 tests, coverage gate 90%) |
   | web | `apps/web/`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `backend/openapi/v1.json` | lint, typecheck, vitest on 6 workers, prettier, the production build |
   | infra | `infra/`, `.github/` | shellcheck, the release-resolution test, actionlint |

   The checks of the changed parts run in parallel; their logs go to a temporary folder whose path the
   script prints in its `Checking: ... (logs in <folder>)` line.
3. If any check fails it prints the last 40 lines of that log and stops. Nothing is pushed.
4. Pushes `main`.
5. Deploys every part the VPS does not serve yet: uploads the backend source (`git archive`) and/or the web
   build (`apps/web/.next/standalone`), installs the new `idraft-activate`, and runs it. On the VPS that:
   1. backend: installs the release into `/srv/idraft/releases/backend/<commit>` (`uv sync --frozen
      --no-dev`), takes a database backup into `/srv/idraft/backups/pre-<commit>-<time>.dump` (keeps 10) and
      runs the migrations as `migrator` (`python -m idraft.db.migrate`, 10 minute limit),
   2. web: installs the release into `/srv/idraft/releases/web/<commit>`,
   3. for each part: points `/srv/idraft/releases/<part>/current` at the new release (the old one becomes
      `previous`), restarts the part's units and checks `GET /api/readyz` and a fresh worker heartbeat
      (backend) or `GET /login` (web), 60 seconds each,
   4. on a failed check, switches every part it switched back to `previous` and exits non-zero.
6. Checks `https://app.idraft.ai/api/readyz` and `/login` from the Mac.

Typical run: about 7 minutes of checks (the backend suite is the long pole) and under a minute of deploy;
each switch costs a few seconds of downtime for that part.

Options: `SHIP_ALL=1` checks and deploys every part; `PYTEST_WORKERS` (default 8) and `VITEST_WORKERS`
(default 6) change the test workers; `infra/ship.sh <ref>` releases another ref than `origin/develop`.

## Rolling back

```bash
infra/ship.sh --rollback backend    # or: web
```

It serves the part's `previous` release again (and that one becomes `previous`, so running it twice goes
back to where you were). It changes production: run it when the owner asks, or when a release is serving
but broken in a way its checks did not catch. A release that fails its checks is switched back already. Migrations are never reverted: the previous backend runs on the newer schema, which
is why migrations must be expand-then-contract (`infra/README.md`, "Forward-Only Migrations Rule").

## When something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| `ship: checks failed: <parts>. Nothing was pushed.` | A check failed | The last 40 lines are printed; the full log is in the folder from the `Checking:` line. Fix on `develop`, run again |
| Web DOM tests time out only during a release | CPU contention with the backend suite | Run the file alone to confirm; lower `VITEST_WORKERS` or `PYTEST_WORKERS` |
| `does not merge cleanly into main` | `main` has commits `develop` lacks | Merge `origin/main` into `develop`, resolve, push, run again |
| git's own `rejected` / `non-fast-forward` output after "Pushing main" | `main` moved while the checks ran | Run again |
| `Docker does not answer` | Colima is stopped | `colima start --cpu 10 --memory 16`, then `docker start idraft-dev-postgres-1 idraft-dev-redis-1 idraft-dev-objects-1` for the dev stack |
| `ship: activation failed: the VPS kept or restored the previous release.` (the VPS side logs `release <commit> failed its checks and was switched back`) | Install, migration or a health check failed on the VPS | `main` already has the commit: do not revert `main`, fix forward. Read `/var/log/idraft-activate.log` on the VPS, fix on `develop`, run again: the next run deploys whatever the VPS still lacks |
| `migration failed; nothing was switched (backup above)` | The migration errored | The database backup from that run is in `/srv/idraft/backups`; the unswitched release folder is replaced by the next run. Fix the migration; never edit the schema by hand |
| `STILL UNHEALTHY after switching back` | Both releases fail their checks | Look at `journalctl -u idraft-api -u idraft-worker -u idraft-web -n 200` on the VPS before anything else |
| `another release is being activated` | A release holds `/run/idraft-activate.lock` | Wait for it |
| `cannot ask the VPS what <part> serves` | SSH to the VPS fails | Check `ssh root@187.126.121.25 true` |

## On the VPS

| Path or command | What |
|---|---|
| `/srv/idraft/releases/<backend|web>/<commit>` | One folder per release; `current` and `previous` are links. 5 kept per part. |
| `/srv/idraft/backend`, `/srv/idraft/web` | Links to `.../current`, the paths the units use |
| `/srv/idraft/releases/history.log` | One line per switch, failure and rollback |
| `/var/log/idraft-activate.log` | Full output of every activation |
| `/srv/idraft/backups/` | Database dump before every backend release (root only) |
| `/etc/idraft/{api,worker,migrator,db,redis}.env` | Environment of the units (root and group `idraft` only; never print or copy them) |
| `/etc/systemd/system/idraft-*.service.d/release.conf` | `RELEASE_SHA`, written by each release |
| `ssh root@187.126.121.25 /usr/local/sbin/idraft-activate deployed backend` | The commit a part serves (or `web`) |
| `GET /api/internal/health` with `Authorization: Bearer <HEALTH_TOKEN>` | The full health report; `versions.release` is the serving backend commit |

`infra/vps/setup-releases.sh` turned the hand-built install into this layout once (2026-11-05). It is safe
to run again but there is no need to.

## Not in use (do not follow)

- `.github/workflows/backend.yml`, `web.yml`, `infra.yml`, `deploy.yml`: disabled. `gh workflow enable` would
  turn them back on; only the owner decides that.
- The Docker Compose stack, `infra/deploy.sh`, `infra/bootstrap.sh`, `infra/host/*` and most of
  `infra/README.md`: the target design, not the running system. Moving to it is planned in
  `docs/superpowers/plans/2026-11-05-vps-compose-cutover.md`.
- `docs/22-infrastructure-devops.md` section 8 (CI/CD) and the Compose sections, `docs/26-testing-quality.md`
  section 10.1, the CI/CD row of ADR-022, the GitHub Actions item in `docs/31-implementation-checklist.md`
  and the pull request CI in `docs/20-frontend-specification.md` section 9.3: the same target design.
- `/etc/seo-platform/.env` and `/etc/idraft/.env` in those documents: the live units read
  `/etc/idraft/{api,worker,migrator}.env`.

## Open items

- No nightly database backup leaves the VPS yet; only the pre-release dumps on the VPS itself exist. The
  owner will set this up.

## Changing this process

Change `infra/ship.sh` or `infra/vps/activate.sh` on `develop` like any other code; the next release
installs the new `idraft-activate` before it runs. Update this page, `AGENTS.md` and the top of
`infra/README.md` in the same commit.

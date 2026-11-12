# Working in this repository (for coding agents)

Read this first. It applies to every agent and every session on this repository: Claude Code, Codex,
Cursor or any other.

## Where things are

| Path | What |
|---|---|
| `backend/` | FastAPI API, Taskiq worker, migrations (Python 3.13, `uv`) |
| `apps/web/` | The Next.js app served at `app.idraft.ai` (pnpm workspace at the repository root) |
| `infra/` | `ship.sh` (releases), `vps/` (what runs on the server), and the Docker Compose stack that is not in use yet |
| `docs/` | Numbered specification documents, ADRs, plans (`docs/superpowers/plans/`), runbooks (`docs/ops/`) |

UI work: read `AI_DEVELOPMENT_UI_RULES.md` and `DESIGN_SYSTEM.md` before changing anything that renders.

## Branches and releases

The full runbook is [docs/ops/release-and-deploy.md](docs/ops/release-and-deploy.md). The rules:

1. Work lands in `develop`, pushed to `origin/develop`. Use a short-lived branch or worktree for parallel
   work and merge it into `develop`.
2. `main` is what is live. Only `infra/ship.sh` pushes `main`, and only when the owner says to release
   ("ship it" or "release" in chat counts). Never push, merge or open a pull request into `main` yourself,
   and never revert `main`: fix forward on `develop`.
3. `infra/ship.sh` runs every check on this machine, pushes `main` only when they pass, and deploys to the
   VPS, which switches back by itself when the new release fails its health checks. It takes about 8
   minutes: run it in the background. Rollback, only when the owner asks or a serving release is broken in
   a way its checks missed: `infra/ship.sh --rollback backend` (or `web`).
4. One release at a time: `pgrep -f 'bash.*infra/ship.sh'` must print nothing before you start one.
5. GitHub Actions is off on purpose (the `backend`, `web`, `infra` and `deploy` workflows are disabled).
   Do not enable it and do not wait for GitHub checks.
6. Never deploy or change the server by hand. Never print, copy or commit anything from `/etc/idraft`.
7. The Docker Compose stack, `infra/deploy.sh`, `infra/bootstrap.sh` and the GitHub deploy pipeline
   described in `infra/README.md` and `docs/22-infrastructure-devops.md` are the target design, not the
   running system.

## Checks before you hand work over

The same checks `infra/ship.sh` runs; run the ones for the parts you touched.

Backend (needs Docker through Colima; the variables are required on this Mac):

```bash
colima status || colima start --cpu 10 --memory 16
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
cd backend && uv sync --frozen && ./check.sh
```

`check.sh` runs ruff, ruff format, mypy, the import contracts and pytest on 4 workers (pass `-n 8` for
more, `-n 0` for serial, or a test path to run part of the suite; a partial run fails the coverage gate,
so add `--no-cov`).

Web (from the repository root, then in `apps/web`):

```bash
pnpm install --frozen-lockfile
cd apps/web && pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build
```

Infra: `shellcheck -x` on the scripts you changed and `actionlint`.

When the API changes, backend commits update `backend/openapi/v1.json`; the web session regenerates the
client (`pnpm gen:api` in `apps/web`) in its own commit right after, and the CI-free checks must stay green
on both sides.

## Working beside other sessions

Several agent sessions often work on this repository at once, sharing the main checkout at
`/Users/a12345/Desktop/AI/idraft/platform`.

- Do your work in your own worktree under `.claude/worktrees/<name>`; do not switch branches, reset or
  stash in the main checkout, and never stage another session's files.
- Do not delete a worktree you did not create. `.claude/worktrees/release` belongs to `infra/ship.sh`,
  which runs `git reset --hard` and `git clean` in it on every release: never work in it or run commands
  from inside it.
- Do not restart Colima or stop the dev stack (`idraft-dev-*` containers) while another session may be
  using them.
- Infrastructure and operations work (server config, compression, deploy scripts, backups, monitoring)
  belongs to the ops session, not to the backend or web sessions; they raise it with the owner or the ops
  session.

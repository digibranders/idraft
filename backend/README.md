# Sightline backend

FastAPI API and Taskiq worker. Architecture: `docs/adr/ADR-022-python-backend-simplified-platform.md`.

## Requirements

Python 3.13, [uv](https://docs.astral.sh/uv/), and Docker. The tests start PostgreSQL 18 and Redis 8 containers, so the `docker` command must be on the PATH.

## Run locally

Start PostgreSQL and Redis (loopback ports 54329 and 63799, so they do not collide with a local install):

```bash
docker compose -f ../infra/compose/docker-compose.dev.yml up -d --wait
```

The first start runs `infra/compose/postgres/initdb/10-roles.sh`, which creates the four database roles. It is the same script production uses.

Create the local settings files (the API connects as `app_api`, migrations run as `migrator`):

```bash
cp .env.example .env && cp .env.migrator.example .env.migrator
```

Apply the migrations:

```bash
uv run --env-file .env.migrator python -m sightline.db.migrate
```

Start the API with reload:

```bash
uv run --env-file .env uvicorn sightline.api.main:create_app --factory --reload --no-access-log --port 8000
```

`http://127.0.0.1:8000/api/readyz` returns `200` when PostgreSQL, Redis and the schema are in place.

### Signing in locally

Registration is by invitation (`REGISTRATION=invited`, the default), so the first account is made by hand. The command connects as `migrator` and asks for a password of at least 12 characters:

```bash
uv run --env-file .env.migrator python -m sightline.cli create-operator --email you@example.com --name "Your Name"
```

That account is a verified platform operator and can sign in at `POST /api/v1/auth/sign-in`. The command checks the password's length but not the breached-password list (it makes no network calls), and it never changes an account that already exists. To let anyone register instead, start the API with `REGISTRATION=open`.

Emails are not sent in local development. The console sender prints each message, link included, to the API's stderr. It is refused unless `APP_ORIGIN` is a local address, so it cannot be left on by accident on a server.

Two things to know when calling the API by hand:

- Every `POST`, `PUT`, `PATCH` and `DELETE` needs the header `Origin: http://localhost:3000` (the value of `APP_ORIGIN`). Without it the answer is `403 origin_not_allowed`.
- The session cookie is `Secure`. Chrome and Firefox accept it over `http://localhost`; Safari does not, so use one of those two or put HTTPS in front.

## Checks

One script runs every gate CI runs (ruff, format, mypy, import contracts, tests with coverage) and stops at the first failure:

```bash
./check.sh
```

## The image

`smoke.sh` runs a built image the way production does: it migrates a fresh PostgreSQL 18 with only `DATABASE_URL` set, starts the API, and requires `/api/readyz` to answer 200 as uid 10001. CI runs it on every change.

```bash
docker build --target api -t sightline-api:dev . && ./smoke.sh sightline-api:dev
```

## Layout

| Package | Holds | Rule (enforced by import-linter) |
|---|---|---|
| `sightline.api` | FastAPI app, routers, error responses | entrypoint |
| `sightline.worker` | Taskiq tasks and scheduler ticks | entrypoint |
| `sightline.domain` | metrics, rank derivation, statistics | pure: no internal imports, no I/O |
| `sightline.extraction` | canonicalizer, matchers, parsers | pure: no internal imports, no I/O |
| `sightline.providers` | provider adapters | never imports the database layer |
| `sightline.collectors` | planners, submitters, fetchers, ingesters | owns persistence |
| `sightline.db` | engine, sessions, migrations | never imports the entrypoints |
| `sightline.storage` | object storage, raw payloads | never imports the entrypoints |
| `sightline.config` | settings, logging, Sentry | never imports the entrypoints |

## Migrations

Revisions live in `src/sightline/db/migrations/versions/` and are written as SQL in `op.execute(...)`. Create one with:

```bash
uv run --env-file .env.migrator alembic revision --rev-id 0005 -m "describe the change"
```

Revision ids are sequential (`0001`, `0002`, ...) so the history reads in order. The migrator takes a PostgreSQL advisory lock, so two running at once queue instead of colliding.

The version table is `ops.alembic_version`. `/api/readyz` reports `migrations: false` until the database is at the revision the running build expects.

## Database roles and tenant isolation

| Role | Used by | Notes |
|---|---|---|
| `migrator` | migrations | Owns every schema and table. Not a superuser |
| `app_api` | the API | Subject to row-level security: it sees only the workspace set on the transaction |
| `app_worker` | the worker | Reads across workspaces; never reachable from a request |
| `backup` | `pg_dump` | Read-only |

Code that touches tenant data opens its transaction with `workspace_transaction(sessions, workspace_id)` from `sightline.db.engine`. A transaction that does not is shown no tenant rows. `user_transaction(sessions, user_id)` is for the few requests that run before a workspace is chosen: it shows a user their own memberships and workspaces, nothing else.

A new table with a `workspace_id` column needs `tenant_isolation(...)` and `grants(...)` from `sightline.db.ddl` in its revision. Two tests fail until it has them: the catalog check in `tests/db/test_rls.py` and the grant matrix in `tests/db/test_grants.py`.

Grants are least privilege. Give a role `UPDATE` on a whole table only when it may change every column; otherwise use `column_grant(...)` for the columns it changes. The worker bypasses row-level security, so it never gets `UPDATE` on `workspace_id`, `project_id` or an identity column. When a route or job needs a new privilege, add it in the same revision as the code, update the matrix in `tests/db/test_grants.py` and the table in `docs/04-data-model.md` section 13.1. Row-level security does not stop SQL injection (the workspace setting can be set by any SQL the API runs), so application code never builds SQL from strings; ruff rule `S608` fails the build on it.

## API contract

`openapi/v1.json` is generated from the code and committed; a test fails when it drifts. Regenerate it with:

```bash
uv run python -m sightline.api.openapi > openapi/v1.json
```

## Logs

Every line on stdout is one JSON object (`ts`, `level`, `msg`, `service`, `version`, plus context such as `request_id`), including the lines of uvicorn, SQLAlchemy and Alembic. Keys that name a credential (`password`, `session_token`, `authorization`, `DATAFORSEO_*`, ...) are redacted at any depth, in dicts, header lists, models and dataclasses. Request lines carry the route template, never the raw URL. Database errors name the statement and never its bound values. Sentry receives no request bodies, cookies, query strings or frame locals.

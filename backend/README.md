# Sightline backend

FastAPI API and Taskiq worker. Architecture: `docs/adr/ADR-022-python-backend-simplified-platform.md`.

## Requirements

Python 3.13, [uv](https://docs.astral.sh/uv/), and Docker. The tests start PostgreSQL 18 and Redis 8 containers, so the `docker` command must be on the PATH.

## Run locally

Start PostgreSQL and Redis (loopback ports 54329 and 63799, so they do not collide with a local install):

```bash
docker compose -f ../infra/compose/docker-compose.dev.yml up -d --wait
```

Create the local settings file:

```bash
cp .env.example .env
```

Apply the migrations:

```bash
uv run --env-file .env python -m sightline.db.migrate
```

Start the API with reload:

```bash
uv run --env-file .env uvicorn sightline.api.main:create_app --factory --reload --no-access-log --port 8000
```

`http://127.0.0.1:8000/api/readyz` returns `200` when PostgreSQL, Redis and the schema are in place.

## Checks

One script runs every gate CI runs (ruff, format, mypy, import contracts, tests with coverage) and stops at the first failure:

```bash
./check.sh
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
uv run --env-file .env alembic revision -m "describe the change"
```

The version table is `ops.alembic_version`. `/api/readyz` reports `migrations: false` until the database is at the revision the running build expects.

## API contract

`openapi/v1.json` is generated from the code and committed; a test fails when it drifts. Regenerate it with:

```bash
uv run python -m sightline.api.openapi > openapi/v1.json
```

## Logs

Every line on stdout is one JSON object (`ts`, `level`, `msg`, `service`, `version`, plus context such as `request_id`). Secret-shaped keys are redacted at any depth. Request lines carry the route template, never the raw URL.

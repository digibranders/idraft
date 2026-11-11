#!/usr/bin/env bash
# Every gate CI runs, in the same order. Stops at the first failure.
set -euo pipefail
cd "$(dirname "$0")"
uv run ruff check .
uv run ruff format --check .
uv run mypy
uv run lint-imports
# Four workers, each with its own PostgreSQL, Redis and object store containers (the session fixtures run
# once per worker). The suite waits on the databases far more than on the CPU. infra/ship.sh passes -n 8
# (Colima has 10 CPUs); a later -n wins, and -n 0 runs serially.
uv run pytest -n 4 "$@"

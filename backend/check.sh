#!/usr/bin/env bash
# Every gate CI runs, in the same order. Stops at the first failure.
set -euo pipefail
cd "$(dirname "$0")"
uv run ruff check .
uv run ruff format --check .
uv run mypy
uv run lint-imports
uv run pytest "$@"

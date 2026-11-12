"""The import contract that keeps the dev seed reachable from the operator CLI only must list every
other top-level package of idraft, so a package added later cannot slip past it."""

from __future__ import annotations

import tomllib
from pathlib import Path

import idraft

BACKEND = Path(__file__).parents[2]
CONTRACT = "the dev seed is reached only from the operator CLI"
# The seed itself and its only caller.
ALLOWED = {"cli", "devseed"}


def test_the_contract_lists_every_top_level_package_but_the_cli_and_the_seed() -> None:
    config = tomllib.loads((BACKEND / "pyproject.toml").read_text(encoding="utf-8"))
    contract = next(
        found for found in config["tool"]["importlinter"]["contracts"] if found["name"] == CONTRACT
    )
    root = Path(idraft.__file__).parent
    top_level = {
        path.stem if path.is_file() else path.name
        for path in root.iterdir()
        if (path.is_dir() and (path / "__init__.py").exists())
        or (path.is_file() and path.suffix == ".py" and path.stem != "__init__")
    }

    assert contract["forbidden_modules"] == ["idraft.devseed"]
    assert set(contract["source_modules"]) == {f"idraft.{name}" for name in top_level - ALLOWED}

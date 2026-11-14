"""The import contract that keeps the dev seed reachable from the operator CLI only must list every
other top-level package of idraft, so a package added later cannot slip past it."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tomllib
from pathlib import Path
from typing import Any

import idraft

BACKEND = Path(__file__).parents[2]
CONTRACT = "the dev seed is reached only from the operator CLI"
# The seed itself and its only caller.
ALLOWED = {"cli", "devseed"}
_RUN_LINTER = (
    "import sys; from importlinter.cli import lint_imports; "
    "sys.exit(lint_imports(config_filename='pyproject.toml', no_cache=True, no_logo=True))"
)


def _contract() -> dict[str, Any]:
    config = tomllib.loads((BACKEND / "pyproject.toml").read_text(encoding="utf-8"))
    contracts: list[dict[str, Any]] = config["tool"]["importlinter"]["contracts"]
    return next(found for found in contracts if found["name"] == CONTRACT)


def _lint_a_copy(tmp_path: Path, *, importer: str | None) -> subprocess.CompletedProcess[str]:
    """Run import-linter on a stand-in `idraft` package that holds the real contract's modules, in
    a child process so the real package is not shadowed. `importer` is a module that imports the
    seed (for example `api.bad`), or None for a clean tree."""
    contract = _contract()
    package = tmp_path / "idraft"
    names = [module.removeprefix("idraft.") for module in contract["source_modules"]]
    for name in [*names, "devseed"]:
        module = package.joinpath(*name.split("."))
        module.mkdir(parents=True, exist_ok=True)
        (module / "__init__.py").write_text("", encoding="utf-8")
    (package / "__init__.py").write_text("", encoding="utf-8")
    if importer is not None:
        (package.joinpath(*importer.split(".")).with_suffix(".py")).write_text(
            "import idraft.devseed\n", encoding="utf-8"
        )
    (tmp_path / "pyproject.toml").write_text(
        '[tool.importlinter]\nroot_package = "idraft"\n\n'
        "[[tool.importlinter.contracts]]\n"
        f'name = {json.dumps(CONTRACT)}\ntype = "forbidden"\n'
        f"source_modules = {json.dumps(contract['source_modules'])}\n"
        f"forbidden_modules = {json.dumps(contract['forbidden_modules'])}\n",
        encoding="utf-8",
    )
    return subprocess.run(
        [sys.executable, "-c", _RUN_LINTER],
        cwd=tmp_path,
        env={**os.environ, "PYTHONPATH": str(tmp_path)},
        capture_output=True,
        text=True,
        check=False,
    )


def test_import_linter_fails_when_the_api_imports_the_seed(tmp_path: Path) -> None:
    result = _lint_a_copy(tmp_path, importer="api.bad")

    assert result.returncode == 1, result.stdout + result.stderr
    assert "idraft.api.bad -> idraft.devseed" in result.stdout


def test_import_linter_passes_when_nothing_imports_the_seed(tmp_path: Path) -> None:
    result = _lint_a_copy(tmp_path, importer=None)

    assert result.returncode == 0, result.stdout + result.stderr


def test_the_contract_lists_every_top_level_package_but_the_cli_and_the_seed() -> None:
    contract = _contract()
    root = Path(idraft.__file__).parent
    top_level = {
        path.stem if path.is_file() else path.name
        for path in root.iterdir()
        if (path.is_dir() and (path / "__init__.py").exists())
        or (path.is_file() and path.suffix == ".py" and path.stem != "__init__")
    }

    assert contract["forbidden_modules"] == ["idraft.devseed"]
    assert set(contract["source_modules"]) == {f"idraft.{name}" for name in top_level - ALLOWED}

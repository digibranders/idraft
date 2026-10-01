"""A DataForSEO stand-in for the adapter's tests: an httpx transport that answers from the
fixtures, and a call gate that records its turns."""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import timedelta
from pathlib import Path
from typing import Any

import httpx

from sightline.providers.contract import GateUnavailableError

FIXTURES = Path(__file__).parents[2] / "fixtures" / "dataforseo"
ORIGIN = "https://api.dataforseo.test"
LOGIN = "owner@example.com"
PASSWORD = "s3cret-password-never-logged"

Handler = Callable[[httpx.Request], httpx.Response]


def fixture(name: str) -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads((FIXTURES / f"{name}.json").read_text())
    return loaded


def fixture_bytes(name: str) -> bytes:
    return (FIXTURES / f"{name}.json").read_bytes()


def envelope(tasks: list[Any], *, status_code: int = 20000, message: str = "Ok.") -> dict[str, Any]:
    """An answer holding these tasks; a test may put anything among them."""
    errors = [
        task for task in tasks if isinstance(task, dict) and task.get("status_code", 0) >= 40000
    ]
    return {
        "version": "0.1.20260915",
        "status_code": status_code,
        "status_message": message,
        "time": "0.0100 sec.",
        "cost": 0,
        "tasks_count": len(tasks),
        "tasks_error": len(errors),
        "tasks": tasks,
    }


def task_answer(
    *,
    status_code: int = 20000,
    message: str = "Ok.",
    task_id: str | None = "10011234-1535-0066-0000-5b2e1e3c3b86",
    cost: object = 0,
    data: dict[str, Any] | None = None,
    result: list[Any] | None = None,
) -> dict[str, Any]:
    return {
        "id": task_id,
        "status_code": status_code,
        "status_message": message,
        "time": "0.0050 sec.",
        "cost": cost,
        "result_count": 0 if result is None else len(result),
        "path": ["v3"],
        "data": data or {},
        "result": result,
    }


def as_json(body: dict[str, Any], status: int = 200) -> httpx.Response:
    return httpx.Response(status, json=body)


@dataclass
class Api:
    """Answers each path with its handler, and keeps what was asked and in which order among
    the gate's turns."""

    events: list[str]
    routes: dict[tuple[str, str], Handler] = field(default_factory=dict)
    requests: list[httpx.Request] = field(default_factory=list)

    def on(self, method: str, path: str, handler: Handler) -> None:
        self.routes[(method, path)] = handler

    def answer(self, method: str, path: str, body: dict[str, Any], status: int = 200) -> None:
        self.on(method, path, lambda _request: as_json(body, status))

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        self.events.append(f"call {request.method} {request.url.path}")
        handler = self.routes.get((request.method, request.url.path))
        if handler is None:
            return httpx.Response(404, json={"status_code": 40400, "status_message": "Not Found."})
        return handler(request)

    def posted(self, index: int = -1) -> Any:
        return json.loads(self.requests[index].content)


@dataclass
class FakeGate:
    """Gives every turn, or none, and says what it was asked."""

    events: list[str]
    gives_turns: bool = True
    fails: bool = False
    cannot_slow: bool = False
    waits: list[timedelta] = field(default_factory=list)
    slowed: int = 0

    async def enter(self, family: str | None, *, within: timedelta) -> bool:
        self.events.append(f"turn {family}")
        self.waits.append(within)
        if self.fails:
            raise GateUnavailableError("ConnectionError")
        return self.gives_turns

    async def slow_down(self) -> None:
        self.slowed += 1
        if self.cannot_slow:
            raise GateUnavailableError("ConnectionError")

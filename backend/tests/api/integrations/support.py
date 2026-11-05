"""Helpers for the integration route tests: a world with callers of each role, and the steps of
the connect flow against a fake Google."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from urllib.parse import parse_qs, urlsplit

import httpx
from asgi_lifespan import LifespanManager
from pydantic import SecretStr

from idraft.api.main import create_app
from idraft.api.resources import Resources
from idraft.config.settings import Settings
from tests.api.auth.support import (
    Workspace,
    add_member,
    cookie,
    fetchrow,
    make_user,
    make_workspace,
    open_session,
)
from tests.conftest import BASE_URL, PostgresServer
from tests.providers.google.fake_google import CLIENT_ID, CLIENT_SECRET, Account, FakeGoogle

CALLBACK = "/api/v1/oauth/google/callback"
REDIRECT_URI = BASE_URL + CALLBACK
HOST = "acme.example"


@dataclass(frozen=True)
class Caller:
    user_id: uuid.UUID
    headers: dict[str, str]


@dataclass(frozen=True)
class Harness:
    api: httpx.AsyncClient
    resources: Resources
    fake: FakeGoogle
    pg: PostgresServer


@dataclass(frozen=True)
class World:
    workspace: Workspace
    project_id: uuid.UUID
    owner: Caller
    admin: Caller
    editor: Caller
    viewer: Caller
    workspace_slug: str
    project_slug: str


@asynccontextmanager
async def running(
    app_settings: Settings, pg: PostgresServer, fake: FakeGoogle | None = None, **changes: object
) -> AsyncIterator[Harness]:
    """The application with Google configured and its outbound calls going to a fake."""
    fake = fake or FakeGoogle(REDIRECT_URI)
    settings = app_settings.model_copy(
        update={
            "google_oauth_client_id": SecretStr(CLIENT_ID),
            "google_oauth_client_secret": SecretStr(CLIENT_SECRET),
            **changes,
        }
    )
    application = create_app(settings, http_transport=fake.transport)
    async with LifespanManager(application):
        resources = application.state.resources
        assert isinstance(resources, Resources)
        await resources.redis.flushdb()
        transport = httpx.ASGITransport(app=application, raise_app_exceptions=False)
        async with httpx.AsyncClient(
            transport=transport, base_url=BASE_URL, headers={"Origin": BASE_URL}
        ) as client:
            yield Harness(client, resources, fake, pg)


async def make_caller(h: Harness, workspace: Workspace, role: str, *, fresh: bool = True) -> Caller:
    user = await make_user(h.pg)
    await add_member(h.pg, workspace, user, role)
    token, _ = await open_session(h.resources, user, fresh=fresh)
    return Caller(user.id, cookie(token))


async def make_project(
    h: Harness, workspace: Workspace, *, host: str | None = HOST, slug: str | None = None
) -> tuple[uuid.UUID, str]:
    slug = slug or f"p-{uuid.uuid4().hex[:10]}"
    domain_id = None
    if host is not None:
        row = await fetchrow(
            h.pg,
            "INSERT INTO core.domains (host, registrable_domain, public_suffix) "
            "VALUES ($1, $2, 'example') ON CONFLICT (host) DO UPDATE SET host = excluded.host "
            "RETURNING id",
            host,
            ".".join(host.split(".")[-2:]),
        )
        domain_id = row["id"]
    row = await fetchrow(
        h.pg,
        "INSERT INTO core.projects (workspace_id, name, slug, primary_domain_id) "
        "VALUES ($1, 'Site', $2, $3) RETURNING id",
        workspace.id,
        slug,
        domain_id,
    )
    project_id: uuid.UUID = row["id"]
    return project_id, slug


async def make_world(h: Harness, *, host: str | None = HOST) -> World:
    workspace = await make_workspace(h.pg)
    project_id, slug = await make_project(h, workspace, host=host)
    return World(
        workspace=workspace,
        project_id=project_id,
        owner=await make_caller(h, workspace, "owner"),
        admin=await make_caller(h, workspace, "admin"),
        editor=await make_caller(h, workspace, "editor"),
        viewer=await make_caller(h, workspace, "viewer"),
        workspace_slug=workspace.slug,
        project_slug=slug,
    )


def project_url(world: World, *parts: object) -> str:
    return "/".join(
        [f"/api/v1/workspaces/{world.workspace.id}/projects/{world.project_id}", *map(str, parts)]
    )


def workspace_url(workspace: Workspace, *parts: object) -> str:
    return "/".join([f"/api/v1/workspaces/{workspace.id}", *map(str, parts)])


async def start(h: Harness, world: World, caller: Caller) -> httpx.Response:
    return await h.api.post(
        project_url(world, "integrations", "gsc", "authorize"), headers=caller.headers
    )


def parts_of(authorization_url: str) -> dict[str, str]:
    return {name: values[0] for name, values in parse_qs(urlsplit(authorization_url).query).items()}


async def callback(h: Harness, caller: Caller | None, **query: str) -> httpx.Response:
    return await h.api.get(CALLBACK, params=query, headers={} if caller is None else caller.headers)


def location(response: httpx.Response) -> tuple[str, dict[str, str]]:
    """Where a 302 goes: the address without its query, and the query."""
    assert response.status_code == 302, response.text
    target = urlsplit(response.headers["location"])
    base = f"{target.scheme}://{target.netloc}{target.path}"
    return base, {k: v[0] for k, v in parse_qs(target.query).items()}


def integrations_page(world: World) -> str:
    return f"{BASE_URL}/{world.workspace_slug}/{world.project_slug}/integrations/gsc"


async def connect(
    h: Harness,
    world: World,
    caller: Caller,
    account: Account,
    **grant: object,
) -> httpx.Response:
    """The whole round trip: start, Google's consent (a code for the challenge), the callback."""
    started = await start(h, world, caller)
    assert started.status_code == 200, started.text
    query = parts_of(started.json()["data"]["authorization_url"])
    code = h.fake.issue_code(account, challenge=query["code_challenge"], **grant)  # type: ignore[arg-type]
    return await callback(h, caller, code=code, state=query["state"])


async def connected(
    h: Harness, world: World, account: Account, caller: Caller | None = None
) -> str:
    response = await connect(h, world, caller or world.owner, account)
    base, query = location(response)
    assert base == integrations_page(world), response.headers["location"]
    return query["connection_id"]

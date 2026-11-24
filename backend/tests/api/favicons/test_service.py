"""Finding, normalising and keeping a site's icon, with the internet faked."""

from __future__ import annotations

import dataclasses

import httpx
import pytest
from fastapi import FastAPI

from idraft.api.favicons.icons import icon_links, to_png
from idraft.api.favicons.service import FETCHES_PER_MINUTE, FaviconService
from idraft.api.resources import Resources
from tests.api.auth.support import Workspace, make_workspace
from tests.api.entities.support import Caller, member, problem
from tests.api.favicons.support import Internet, html, ico, image, png
from tests.conftest import PostgresServer

PUBLIC = ["93.184.216.34"]


def test_declared_icons_come_largest_first_with_relative_addresses_resolved() -> None:
    page = (
        b'<link rel="icon" href="/small.png" sizes="16x16">'
        b'<link rel="apple-touch-icon" href="touch.png" sizes="180x180">'
        b'<link rel="shortcut icon" href="/plain.ico">'
        b'<link rel="icon" href="/v.svg" type="image/svg+xml">'
        b'<link rel="stylesheet" href="/s.css">'
    )
    assert icon_links(page, "https://acme.com/en/") == [
        "https://acme.com/en/touch.png",
        "https://acme.com/small.png",
        "https://acme.com/plain.ico",
    ]


async def test_images_are_normalised_to_a_png_of_32_to_128_px() -> None:
    import io

    from PIL import Image

    wide = await to_png(png(300))
    assert wide is not None
    assert Image.open(io.BytesIO(wide)).size == (128, 128)
    exact = await to_png(png(32))
    assert exact is not None
    assert Image.open(io.BytesIO(exact)).size == (32, 32)
    # An ICO is read at its largest size
    both = await to_png(ico(16, 48))
    assert both is not None
    assert Image.open(io.BytesIO(both)).size == (48, 48)


@pytest.mark.parametrize("body", [png(31), png(16), ico(16), b"<html>not an image</html>", b""])
async def test_what_is_too_small_or_not_an_image_is_none(body: bytes) -> None:
    assert await to_png(body) is None


@pytest.fixture
def web() -> dict[str, httpx.Response]:
    return {}


def _internet(
    pages: dict[str, httpx.Response], names: dict[str, list[str]] | None = None
) -> Internet:
    def handler(request: httpx.Request) -> httpx.Response:
        host = request.headers["host"]
        return pages.get(f"{host}{request.url.path}", httpx.Response(404))

    return Internet(names or {"acme.com": PUBLIC, "www.acme.com": PUBLIC}, handler)


@pytest.fixture
async def setup(
    auth_app: FastAPI, resources: Resources, migrated: PostgresServer
) -> tuple[Workspace, Caller, FastAPI, Resources]:
    workspace = await make_workspace(migrated)
    viewer = await member(resources, migrated, workspace, "viewer")
    return workspace, viewer, auth_app, resources


def _use(app: FastAPI, resources: Resources, net: Internet) -> None:
    service = FaviconService(
        redis=resources.redis, throttle=resources.favicons._throttle, fetcher=net.fetcher()
    )
    app.state.resources = dataclasses.replace(resources, favicons=service)


async def _get(
    api: httpx.AsyncClient, workspace: Workspace, caller: Caller, domain: str
) -> httpx.Response:
    return await api.get(
        f"/api/v1/workspaces/{workspace.id}/favicons/{domain}", headers=caller.headers
    )


async def test_a_declared_icon_is_served_as_a_png_with_a_long_cache_header(
    api: httpx.AsyncClient, setup: tuple[Workspace, Caller, FastAPI, Resources]
) -> None:
    workspace, caller, app, resources = setup
    net = _internet(
        {
            "acme.com/": html('<link rel="icon" href="/i.png" sizes="64x64">'),
            "acme.com/i.png": image(png(64)),
        }
    )
    _use(app, resources, net)
    response = await _get(api, workspace, caller, "acme.com")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "image/png"
    assert response.headers["cache-control"] == "private, max-age=604800"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.content.startswith(b"\x89PNG")


async def test_favicon_ico_is_tried_when_the_page_declares_nothing_usable(
    api: httpx.AsyncClient, setup: tuple[Workspace, Caller, FastAPI, Resources]
) -> None:
    workspace, caller, app, resources = setup
    net = _internet(
        {
            "acme.com/": html('<link rel="icon" href="/tiny.png">'),
            "acme.com/tiny.png": image(png(16)),
            "acme.com/favicon.ico": image(ico(16, 32), "image/x-icon"),
        }
    )
    _use(app, resources, net)
    assert (await _get(api, workspace, caller, "acme.com")).status_code == 200


async def test_a_second_request_is_answered_from_the_cache(
    api: httpx.AsyncClient, setup: tuple[Workspace, Caller, FastAPI, Resources]
) -> None:
    workspace, caller, app, resources = setup
    net = _internet({"acme.com/favicon.ico": image(png(48))})
    _use(app, resources, net)
    first = await _get(api, workspace, caller, "acme.com")
    calls = len(net.requests)
    second = await _get(api, workspace, caller, "www.acme.com")  # the same registrable domain
    assert second.status_code == 200
    assert second.content == first.content
    assert len(net.requests) == calls
    assert await resources.redis.ttl("favicon:v1:acme.com") > 6 * 24 * 3600


async def test_a_site_without_an_icon_is_404_and_is_not_asked_again(
    api: httpx.AsyncClient, setup: tuple[Workspace, Caller, FastAPI, Resources]
) -> None:
    workspace, caller, app, resources = setup
    net = _internet({"acme.com/": html(), "acme.com/favicon.ico": image(png(16))})
    _use(app, resources, net)
    first = await _get(api, workspace, caller, "acme.com")
    assert problem(first) == (404, "not_found")
    assert first.headers["cache-control"] == "private, max-age=21600"
    calls = len(net.requests)
    assert (await _get(api, workspace, caller, "acme.com")).status_code == 404
    assert len(net.requests) == calls
    assert 0 < await resources.redis.ttl("favicon:v1:miss:acme.com") <= 6 * 3600


async def test_a_site_that_cannot_be_reached_is_missed_for_a_shorter_time(
    api: httpx.AsyncClient, setup: tuple[Workspace, Caller, FastAPI, Resources]
) -> None:
    workspace, caller, app, resources = setup

    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    net = Internet({"acme.com": PUBLIC}, down)
    _use(app, resources, net)
    assert (await _get(api, workspace, caller, "acme.com")).status_code == 404
    assert 0 < await resources.redis.ttl("favicon:v1:miss:acme.com") <= 15 * 60


async def test_a_site_that_resolves_inside_gets_no_request_and_no_icon(
    api: httpx.AsyncClient, setup: tuple[Workspace, Caller, FastAPI, Resources]
) -> None:
    workspace, caller, app, resources = setup
    net = _internet(
        {"internal-host.com/favicon.ico": image(png(64))}, {"internal-host.com": ["10.0.0.9"]}
    )
    _use(app, resources, net)
    assert (await _get(api, workspace, caller, "internal-host.com")).status_code == 404
    assert net.requests == []


@pytest.mark.parametrize(
    "domain",
    [
        "localhost",
        "127.0.0.1",
        "10.0.0.1",
        "intranet",
        "acme.invalidtld",
        "acme.com%3A80",
    ],
)
async def test_what_is_not_a_public_domain_is_a_bad_request(
    api: httpx.AsyncClient,
    setup: tuple[Workspace, Caller, FastAPI, Resources],
    domain: str,
) -> None:
    workspace, caller, app, resources = setup
    net = _internet({})
    _use(app, resources, net)
    response = await _get(api, workspace, caller, domain)
    assert problem(response) == (400, "bad_request")
    assert net.requests == []


async def test_fetches_not_yet_kept_are_rate_limited_per_workspace(
    api: httpx.AsyncClient, setup: tuple[Workspace, Caller, FastAPI, Resources]
) -> None:
    workspace, caller, app, resources = setup
    net = _internet({})
    _use(app, resources, net)
    for index in range(FETCHES_PER_MINUTE):
        await _get(api, workspace, caller, f"site{index}.com")
    refused = await _get(api, workspace, caller, "onemore.com")
    assert problem(refused) == (429, "rate_limited")
    assert refused.headers["retry-after"] == "60"
    # Icons that are already kept are not counted
    await resources.redis.set("favicon:v1:kept.com", png(32))
    assert (await _get(api, workspace, caller, "kept.com")).status_code == 200


async def test_a_signed_out_caller_and_a_stranger_get_nothing(
    api: httpx.AsyncClient,
    setup: tuple[Workspace, Caller, FastAPI, Resources],
    migrated: PostgresServer,
) -> None:
    workspace, _, _, resources = setup
    other = await make_workspace(migrated)
    stranger = await member(resources, migrated, other, "owner")
    await resources.redis.set("favicon:v1:kept.com", png(32))
    assert (
        await api.get(f"/api/v1/workspaces/{workspace.id}/favicons/kept.com")
    ).status_code == 401
    assert (await _get(api, workspace, stranger, "kept.com")).status_code == 404
